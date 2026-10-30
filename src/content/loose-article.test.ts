import articleHtml from '../test/fixtures/br-separated-article.html?raw'
import { semanticSegmentSchema } from '../shared/schemas'
import { serializeArticleToBlocks } from '../shared/export/markdown-serializer'
import { SOURCE_WRAPPER_SELECTOR } from '../shared/text-runs'
import { detectArticleRegion, scoreArticleCandidate } from './article-detector'
import { extractSemanticSegments } from './segment-extractor'
import { renderTranslation, restoreOriginalPage, setDisplayMode } from './translation-renderer'

describe('articles with loose text around figures', () => {
  beforeEach(() => {
    document.body.innerHTML = articleHtml
  })

  afterEach(restoreOriginalPage)

  it('extracts all seven body paragraphs and three captions in order without changing the DOM', () => {
    const root = document.querySelector<HTMLElement>('.cn-body')!
    const before = root.innerHTML
    const segments = extractSemanticSegments(root)

    expect(segments).toHaveLength(10)
    expect(segments.map((segment) => segment.tagName)).toEqual([
      'figcaption', 'div', 'div', 'figcaption', 'div', 'div', 'figcaption', 'div', 'div', 'div',
    ])
    expect(segments[1].sourceText).toBe('Memory cells combine a transistor and a capacitor, which complicates scaling. Changing the layout requires careful engineering.')
    expect(segments[5].sourceText).toContain('Capacitor spacing can limit density')
    expect(segments[9].sourceText).toBe('Further research will determine when these designs become practical.')
    expect(root.innerHTML).toBe(before)
    expect(extractSemanticSegments(root)).toEqual(segments)
    expect(semanticSegmentSchema.parse(segments[1]).textRun).toBe(0)
    expect(detectArticleRegion()?.selector).toBe('#memory-article')
    expect(scoreArticleCandidate(root).paragraphCount).toBe(10)
  })

  it('writes translations next to each paragraph and restores the original nodes and markup', () => {
    const root = document.querySelector<HTMLElement>('.cn-body')!
    const before = root.innerHTML
    const link = root.querySelector('a')!
    const click = vi.fn()
    link.addEventListener('click', (event) => { event.preventDefault(); click() })
    const segments = extractSemanticSegments(root)

    // Render in reverse order too: run locators must survive earlier insertions.
    for (const segment of [...segments].reverse()) {
      expect(renderTranslation(segment, `译文 ${segment.order}`, false)).toBe(true)
    }
    expect(root.querySelectorAll('[data-ai-reader-for]')).toHaveLength(10)
    expect(root.querySelectorAll(SOURCE_WRAPPER_SELECTOR)).toHaveLength(7)
    expect(root.querySelectorAll(`${SOURCE_WRAPPER_SELECTOR} img,${SOURCE_WRAPPER_SELECTOR} figure`)).toHaveLength(0)
    expect(root.querySelector('a')).toBe(link)
    link.click()
    expect(click).toHaveBeenCalledOnce()
    expect(extractSemanticSegments(root)).toEqual(segments)
    expect(renderTranslation(segments[1], '更新后的正文译文', false)).toBe(true)
    expect(root.querySelectorAll('[data-ai-reader-for]')).toHaveLength(10)
    setDisplayMode('translation')
    expect(root.classList.contains('ai-reader-translation-original')).toBe(false)
    expect(window.getComputedStyle(root.querySelector(SOURCE_WRAPPER_SELECTOR)!).display).toBe('none')
    expect(window.getComputedStyle(root.querySelector('figure')!).display).not.toBe('none')

    restoreOriginalPage()
    expect(root.innerHTML).toBe(before)
    expect(root.querySelector('a')).toBe(link)
  })

  it('exports every paragraph, link, and image with translation associations before and after rendering', () => {
    const root = document.querySelector<HTMLElement>('.cn-body')!
    const segments = extractSemanticSegments(root)
    const exportBlocks = () => serializeArticleToBlocks({ root, segments, baseUrl: 'https://example.com/story' })
    const before = exportBlocks()
    expect(before.blocks).toHaveLength(10)
    expect(before.media).toHaveLength(3)
    expect(before.blocks.flatMap((block) => block.segmentIds)).toEqual(segments.map((segment) => segment.id))
    expect(before.blocks[1].sourceMarkdown).toContain('[complicates scaling](https://example.com/scaling)')
    segments.forEach((segment) => renderTranslation(segment, '正文和图注译文', false))
    expect(exportBlocks()).toEqual(before)
  })

  it('handles leaf divs separated by br and mixed semantic blocks without duplicating text', () => {
    document.body.innerHTML = '<main><h2>Context</h2><div id="body">First <em>inline</em> paragraph.<br><br>Second paragraph.<p>A semantic paragraph.</p>Trailing text.<div hidden>Hidden text.</div><pre><code>Ignored code</code></pre><div data-ai-reader-inserted>Inserted text.</div></div></main>'
    const segments = extractSemanticSegments(document.querySelector('main')!)
    expect(segments.map((segment) => segment.sourceText)).toEqual([
      'Context', 'First inline paragraph.', 'Second paragraph.', 'A semantic paragraph.', 'Trailing text.',
    ])
    expect(segments[4].headingContext).toEqual(['Context'])
  })

  it('refuses to attach a stale run to a changed paragraph', () => {
    const root = document.querySelector<HTMLElement>('.cn-body')!
    const segment = extractSemanticSegments(root)[1]
    root.innerHTML = 'A different first paragraph.<br><br>Another different paragraph.'
    expect(renderTranslation(segment, '不应写入', false)).toBe(false)
    expect(root.querySelector('[data-ai-reader-for]')).toBeNull()
  })

  it('keeps media, hidden content, and code outside loose source wrappers', () => {
    document.body.innerHTML = '<div id="body">Before media.<video src="/movie.mp4"></video>After media.<pre><code>Skipped code</code></pre>After code.<span hidden>Hidden text.</span>Final paragraph.</div>'
    const root = document.getElementById('body')!
    const before = root.innerHTML
    const segments = extractSemanticSegments(root)
    expect(segments.map((segment) => segment.sourceText)).toEqual([
      'Before media.', 'After media.', 'After code.', 'Final paragraph.',
    ])
    segments.forEach((segment) => expect(renderTranslation(segment, '译文', false)).toBe(true))
    expect(root.querySelectorAll(`${SOURCE_WRAPPER_SELECTOR} video,${SOURCE_WRAPPER_SELECTOR} pre,${SOURCE_WRAPPER_SELECTOR} [hidden]`)).toHaveLength(0)
    restoreOriginalPage()
    expect(root.innerHTML).toBe(before)
  })

  it('keeps locators stable when semantic, div, and loose paragraphs are siblings', () => {
    document.body.innerHTML = '<article><p>A semantic introduction.</p><div>A legacy div paragraph.</div><div>First loose paragraph.<br><br>Second loose paragraph.</div></article>'
    const root = document.querySelector('article')!
    const segments = extractSemanticSegments(root)
    expect(segments).toHaveLength(4)
    for (const segment of segments) expect(renderTranslation(segment, '译文', false)).toBe(true)
    expect(extractSemanticSegments(root)).toEqual(segments)
  })
})
