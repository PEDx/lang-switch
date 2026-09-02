import standardArticle from '../test/fixtures/standard-article.html?raw'
import navigationSidebar from '../test/fixtures/navigation-sidebar.html?raw'
import legacyBlog from '../test/fixtures/legacy-blog.html?raw'
import { collectArticleCandidates, detectArticleRegion, scoreArticleCandidate } from './article-detector'

describe('article detector', () => {
  it('scores article content above navigation', () => {
    document.documentElement.innerHTML = navigationSidebar
    const article = document.querySelector<HTMLElement>('article')!
    const nav = document.querySelector<HTMLElement>('nav')!
    expect(scoreArticleCandidate(article).score).toBeGreaterThan(scoreArticleCandidate(nav).score)
  })

  it('detects the standard article and reports useful metrics', () => {
    document.documentElement.innerHTML = standardArticle
    const result = detectArticleRegion()
    expect(result?.selector).toBe('#post')
    expect(result?.paragraphCount).toBe(6)
    expect(result?.textLength).toBeGreaterThan(400)
    expect(result?.reasons).toContain('使用文章语义标签')
  })

  it('finds a large generic container on a legacy blog instead of defaulting to body', () => {
    document.documentElement.innerHTML = legacyBlog
    const candidates = collectArticleCandidates()
    expect(candidates.some((candidate) => candidate.id === 'story')).toBe(true)
    expect(detectArticleRegion()?.selector).not.toBe('body')
  })

  it('prefers a main element containing many article sections over one local section', () => {
    const paragraphs = (prefix: string, count: number) => Array.from(
      { length: count },
      (_, index) => `<p>${prefix} paragraph ${index} contains enough explanatory article text for scoring.</p>`,
    ).join('')
    document.body.innerHTML = `<main id="tutorial"><section>${paragraphs('Introduction', 4)}</section><section>${paragraphs('Algorithm', 7)}</section><section id="last-section">${paragraphs('Conclusion', 10)}</section></main>`

    expect(detectArticleRegion()?.selector).toBe('#tutorial')
  })

  it('keeps a generic article wrapper when the page is split into sibling sections', () => {
    const paragraph = (text: string) => `<div class="paragraph">${text} This explanatory text is long enough to represent a real article block.</div>`
    document.body.innerHTML = `<div id="content"><section><h2>The A* algorithm</h2>${paragraph('A* is a pathfinding algorithm.')}${paragraph('It combines the cost so far with an estimate.')}</section><section><h2>Implementation</h2>${paragraph('The implementation uses a priority queue.')}${paragraph('The queue determines which node to explore next.')}</section></div>`

    expect(detectArticleRegion()?.selector).toBe('#content')
  })

  it('does not let a table of contents push the complete multi-section article below one section', () => {
    const paragraph = (index: number) => `<p>Paragraph ${index} contains enough explanatory text to model the long-form article content and its surrounding context.</p>`
    const sections = Array.from({ length: 4 }, (_, index) => `<section><h2>Chapter ${index + 1}</h2>${paragraph(index * 2 + 1)}${paragraph(index * 2 + 2)}</section>`).join('')
    const links = Array.from({ length: 12 }, (_, index) => `<a href="#chapter-${index}">Chapter ${index}</a>`).join('')
    document.body.innerHTML = `<div id="content"><nav>${links}</nav>${sections}</div>`

    expect(detectArticleRegion()?.selector).toBe('#content')
  })
})
