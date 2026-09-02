import codeArticle from '../test/fixtures/code-article.html?raw'
import { createSegmentId, extractSemanticSegments } from './segment-extractor'

describe('semantic segment extraction', () => {
  it('extracts complete semantic blocks and ignores code blocks', () => {
    document.documentElement.innerHTML = codeArticle
    const article = document.querySelector<HTMLElement>('article')!
    const segments = extractSemanticSegments(article)
    expect(segments.map((segment) => segment.tagName)).toEqual(['h1', 'p', 'p', 'p', 'p', 'p'])
    expect(segments.some((segment) => segment.sourceText.includes('for await'))).toBe(false)
  })

  it('keeps inline emphasis inside a paragraph as one segment', () => {
    document.body.innerHTML = '<article><p>This is <strong>very important</strong> for developers.</p><p>Another meaningful paragraph for extraction.</p></article>'
    const segments = extractSemanticSegments(document.querySelector('article')!)
    expect(segments[0].sourceText).toBe('This is very important for developers.')
  })

  it('creates stable IDs from URL, path, and source text', () => {
    const first = createSegmentId('#post > p:nth-of-type(1)', 'Stable paragraph', 'https://example.com/post#one')
    const second = createSegmentId('#post > p:nth-of-type(1)', 'Stable paragraph', 'https://example.com/post#two')
    expect(first).toBe(second)
    expect(first).toMatch(/^segment-/)
  })

  it('ignores hidden, numeric, URL, email, and extension nodes', () => {
    document.body.innerHTML = `<article><p hidden>Hidden paragraph</p><p>12345</p><p>https://example.com</p><p>hello@example.com</p><p data-ai-reader-inserted>Inserted translation</p><p>A real paragraph with meaningful source content.</p></article>`
    const segments = extractSemanticSegments(document.querySelector('article')!)
    expect(segments).toHaveLength(1)
    expect(segments[0].sourceText).toContain('meaningful')
  })

  it('ignores semantic elements inside a hidden ancestor', () => {
    document.body.innerHTML = '<article><section style="display:none"><p>Hidden duplicate article paragraph.</p></section><section><p>The visible article paragraph remains available.</p></section></article>'
    const segments = extractSemanticSegments(document.querySelector('article')!)

    expect(segments.map((segment) => segment.sourceText)).toEqual([
      'The visible article paragraph remains available.',
    ])
  })

  it('extracts leaf divs used as paragraphs by hand-authored articles', () => {
    document.body.innerHTML = '<div id="content"><h1>The A* algorithm</h1><div class="paragraph">A* is a pathfinding algorithm that combines known cost and estimated cost.</div><div class="paragraph">This article explains how the queue is ordered and updated.</div></div>'
    const segments = extractSemanticSegments(document.querySelector('#content')!)

    expect(segments.map((segment) => segment.tagName)).toEqual(['h1', 'div', 'div'])
    expect(segments[1].sourceText).toContain('pathfinding algorithm')
  })
})
