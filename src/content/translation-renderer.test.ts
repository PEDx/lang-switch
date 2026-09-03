import type { SemanticSegment } from '../shared/types'
import { renderTranslation, restoreOriginalPage, setDisplayMode } from './translation-renderer'

describe('translation display', () => {
  const segment: SemanticSegment = {
    id: 'segment-one', tagName: 'p', sourceText: 'Original paragraph.',
    elementPath: '#paragraph', order: 0,
  }

  it('inserts an adjacent result without moving the original', () => {
    document.body.innerHTML = '<article><p id="paragraph">Original paragraph.</p></article>'
    const original = document.getElementById('paragraph')
    expect(renderTranslation(segment, '翻译后的段落。', false)).toBe(true)
    expect(original?.nextElementSibling?.getAttribute('data-ai-reader-for')).toBe('segment-one')
    expect(original?.parentElement?.tagName).toBe('ARTICLE')
  })

  it('renders model-provided paragraph breaks as readable paragraphs', () => {
    document.body.innerHTML = '<article><p id="paragraph">Original paragraph.</p></article>'
    expect(renderTranslation(segment, '第一段译文。\n\n第二段译文。', false)).toBe(true)
    const result = document.querySelector<HTMLElement>('[data-ai-reader-for="segment-one"]')!
    const paragraphs = result.querySelectorAll('.ai-reader-translation-paragraph')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].textContent).toBe('第一段译文。')
    expect(paragraphs[1].textContent).toBe('第二段译文。')
  })

  it('switches display mode and fully restores page changes', () => {
    document.body.innerHTML = '<p id="paragraph">Original paragraph.</p>'
    renderTranslation(segment, '译文', false)
    setDisplayMode('translation', 0.4)
    expect(document.documentElement.dataset.aiReaderDisplay).toBe('translation')
    expect(document.documentElement.style.getPropertyValue('--ai-reader-original-opacity')).toBe('0.4')
    restoreOriginalPage()
    expect(document.querySelector('[data-ai-reader-for]')).toBeNull()
    expect(document.getElementById('paragraph')?.className).toBe('')
  })

  it('applies configurable translation style, line height, and font', () => {
    document.body.innerHTML = '<p id="paragraph">Original paragraph.</p>'
    setDisplayMode('bilingual', 0.32, 'highlight', 1.4, 'serif')
    renderTranslation(segment, '译文', false)
    const result = document.querySelector<HTMLElement>('[data-ai-reader-for="segment-one"]')!
    expect(document.documentElement.dataset.aiReaderTranslationStyle).toBe('highlight')
    expect(document.documentElement.dataset.aiReaderTranslationFont).toBe('serif')
    expect(result.style.getPropertyValue('line-height')).toBe('1.4')
    setDisplayMode('bilingual', 0.32, 'immersive', null, 'default')
    expect(document.documentElement.dataset.aiReaderTranslationStyle).toBe('immersive')
    expect(result.style.getPropertyValue('line-height')).toBe('')
    restoreOriginalPage()
  })

  it('renders the hover toolbar at the document root to escape ancestor clipping', () => {
    document.body.innerHTML = '<div style="overflow:hidden"><p id="paragraph">Original paragraph.</p></div>'
    renderTranslation(segment, '译文', true)
    const result = document.querySelector<HTMLElement>('[data-ai-reader-for="segment-one"]')!
    result.dispatchEvent(new MouseEvent('mouseenter'))
    const toolbar = document.querySelector<HTMLElement>('.ai-reader-translation-toolbar')
    expect(toolbar?.parentElement).toBe(document.documentElement)
    expect(toolbar?.classList.contains('is-visible')).toBe(true)
    expect(result.contains(toolbar)).toBe(false)
    restoreOriginalPage()
    expect(document.querySelector('.ai-reader-translation-toolbar')).toBeNull()
  })

  it('recovers the original element by text after an SPA replaces its DOM path', () => {
    document.body.innerHTML = '<article><div><p id="new-paragraph">Original paragraph.</p></div></article>'
    const staleSegment = { ...segment, elementPath: '#old-paragraph' }

    expect(renderTranslation(staleSegment, '重渲染后的译文', false)).toBe(true)
    expect(document.getElementById('new-paragraph')?.nextElementSibling?.textContent).toBe('重渲染后的译文')
  })

  it('does not guess when multiple paragraphs have the same text and the path is stale', () => {
    document.body.innerHTML = '<article><p>Original paragraph.</p><p>Original paragraph.</p></article>'
    const staleSegment = { ...segment, elementPath: '#old-paragraph' }

    expect(renderTranslation(staleSegment, '不应插入', false)).toBe(false)
    expect(document.querySelector('[data-ai-reader-for]')).toBeNull()
  })
})
