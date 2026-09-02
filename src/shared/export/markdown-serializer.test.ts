import type { SemanticSegment } from '../types'
import { createExportArticle } from './article-exporter'
import { serializeArticleToBlocks } from './markdown-serializer'

function segmentsFor(root: HTMLElement): SemanticSegment[] {
  return [...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th')]
    .filter((element) => !element.closest('[data-ai-reader-inserted]'))
    .map((element, order) => {
      const path = `#${element.id}`
      return {
        id: `segment-${element.id}`,
        tagName: element.tagName.toLowerCase(),
        sourceText: element.textContent?.trim() ?? '',
        elementPath: path,
        order,
      }
    })
}

describe('article Markdown serializer', () => {
  it('converts headings, inline formatting, links, anchors, images, and excludes extension nodes', () => {
    document.body.innerHTML = `
      <article id="article">
        <h1 id="title">Architecture</h1>
        <p id="intro">Read <strong>important</strong> <em>notes</em>, <code>a\`b</code>,
          <a href="../docs">Documentation</a> and <a href="#next">next</a>.</p>
        <p data-ai-reader-inserted>扩展译文不应导出</p>
        <img id="diagram" src="/small.png" srcset="/small.png 480w, /large.webp 1200w" alt="System diagram">
        <a href="javascript:alert(1)">unsafe link</a>
      </article>`
    const root = document.querySelector<HTMLElement>('#article')!
    const result = serializeArticleToBlocks({ root, segments: segmentsFor(root), baseUrl: 'https://example.com/blog/post' })
    const markdown = result.blocks.map((block) => block.sourceMarkdown).join('\n\n')
    expect(markdown).toContain('# Architecture')
    expect(markdown).toContain('**important**')
    expect(markdown).toContain('*notes*')
    expect(markdown).toContain('``a`b``')
    expect(markdown).toContain('[Documentation](https://example.com/docs)')
    expect(markdown).toContain('[next](#next)')
    expect(markdown).toContain('![System diagram]({{AI_READER_MEDIA:')
    expect(markdown).not.toContain('扩展译文')
    expect(markdown).not.toContain('javascript:')
    expect(result.media).toHaveLength(1)
    expect(result.media[0].resolvedUrl).toBe('https://example.com/large.webp')
  })

  it('converts nested lists, quotes, code, tables, figures, and HTML5 video', () => {
    document.body.innerHTML = `
      <article id="article">
        <ul><li id="one">First<ul><li id="nested">Nested</li></ul></li></ul>
        <blockquote id="quote">Line one<br>Line two</blockquote>
        <pre><code class="language-ts">const value = 1</code></pre>
        <table><thead><tr><th id="name">Name</th><th id="value">Value</th></tr></thead><tbody><tr><td id="a">A</td><td id="b">B</td></tr></tbody></table>
        <figure><img src="/diagram.png" alt="Architecture"><figcaption id="caption">System architecture</figcaption></figure>
        <video poster="/poster.jpg"><source src="/movie.webm" type="video/webm"><source src="/movie.mp4" type="video/mp4"></video>
        <audio src="/audio.mp3"></audio>
        <iframe src="https://www.youtube.com/watch?v=example"></iframe>
      </article>`
    const root = document.querySelector<HTMLElement>('#article')!
    const result = serializeArticleToBlocks({ root, segments: segmentsFor(root), baseUrl: 'https://example.com/post' })
    const markdown = result.blocks.map((block) => block.sourceMarkdown).join('\n\n')
    expect(markdown).toContain('- First')
    expect(markdown).toContain('  - Nested')
    expect(markdown).toContain('> Line one')
    expect(markdown).toContain('```ts\nconst value = 1\n```')
    expect(markdown).toContain('| Name | Value |')
    expect(markdown).toContain('| --- | --- |')
    expect(markdown).toContain('*System architecture*')
    expect(markdown).toContain('<video controls poster=')
    expect(markdown).toContain('<source src=')
    expect(markdown).toContain('<audio controls src=')
    expect(markdown).toContain('[查看嵌入视频](https://www.youtube.com/watch?v=example)')
    expect(result.media.map((item) => item.type)).toEqual(['image', 'poster', 'video', 'video', 'audio'])
  })

  it('extracts reliable metadata without inventing missing fields', () => {
    document.head.innerHTML = '<meta name="author" content="Ada Lovelace"><meta property="article:published_time" content="2026-07-01"><meta name="description" content="A technical article">'
    document.documentElement.lang = 'en'
    document.body.innerHTML = '<article id="article"><p id="p1">Text</p></article>'
    const root = document.querySelector<HTMLElement>('#article')!
    const article = createExportArticle({
      root, rootElementPath: '#article', segments: segmentsFor(root), title: 'Title: "A"',
      sourceUrl: 'https://example.com/article', targetLanguage: 'zh-CN', exportMode: 'source',
      exportedAt: '2026-07-17T10:00:00+08:00',
    })
    expect(article.metadata).toMatchObject({ author: 'Ada Lovelace', publishedAt: '2026-07-01', sourceLanguage: 'en' })
    expect(article.metadata).not.toHaveProperty('unknown')
  })
})
