import type { DisplayMode, SemanticSegment } from '../shared/types'
import { resolveSegmentElement } from './segment-extractor'

const ORIGINAL_CLASS = 'ai-reader-translation-original'
const RESULT_CLASS = 'ai-reader-translation-result'
const STYLE_ID = 'ai-reader-translation-style'
const TOOLBAR_CLASS = 'ai-reader-translation-toolbar'

let floatingToolbar: HTMLElement | null = null
let toolbarState: { segmentId: string; text: string } | null = null
let hideToolbarTimer: number | undefined

function hideToolbar(): void {
  window.clearTimeout(hideToolbarTimer)
  floatingToolbar?.classList.remove('is-visible')
}

function scheduleToolbarHide(): void {
  window.clearTimeout(hideToolbarTimer)
  hideToolbarTimer = window.setTimeout(hideToolbar, 120)
}

function positionToolbar(result: HTMLElement, toolbar: HTMLElement): void {
  const resultRect = result.getBoundingClientRect()
  toolbar.classList.add('is-visible')
  const toolbarRect = toolbar.getBoundingClientRect()
  const left = Math.min(
    window.innerWidth - toolbarRect.width - 8,
    Math.max(8, resultRect.right - toolbarRect.width - 8),
  )
  const top = Math.min(
    window.innerHeight - toolbarRect.height - 8,
    Math.max(8, resultRect.top + 8),
  )
  toolbar.style.left = `${left}px`
  toolbar.style.top = `${top}px`
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.aiReaderInserted = 'true'
  style.textContent = `
    :root { --ai-reader-original-opacity: .32; }
    html body .${ORIGINAL_CLASS} { opacity: var(--ai-reader-original-opacity) !important; transition: opacity 160ms ease; }
    html body .${ORIGINAL_CLASS}:hover { opacity: .85 !important; }
    html body .${RESULT_CLASS} {
      display: block !important; visibility: visible !important; opacity: 1 !important;
      position: relative; margin: 0; padding: .3em .55em .3em .65em;
      border-inline-start: 2px solid color-mix(in srgb, currentColor 55%, transparent);
      background: color-mix(in srgb, CanvasText 6%, Canvas); color: CanvasText;
      content-visibility: auto; contain-intrinsic-size: auto 80px;
    }
    html[data-ai-reader-translation-style="immersive"] body .${RESULT_CLASS} {
      border-inline-start: 0; background: transparent; color: CanvasText; margin: 0; padding: 0;
    }
    html[data-ai-reader-translation-font="serif"] body .${RESULT_CLASS} {
      font-family: ui-serif, "Songti SC", SimSun, serif !important;
    }
    html[data-ai-reader-translation-font="sans"] body .${RESULT_CLASS} {
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif !important;
    }
    html body .${RESULT_CLASS} > .ai-reader-translation-paragraph {
      display: block !important; margin: 0 0 .72em !important; padding: 0 !important;
      color: inherit !important; font: inherit !important; line-height: inherit !important;
    }
    html body .${RESULT_CLASS} > .ai-reader-translation-paragraph:last-child {
      margin-bottom: 0 !important;
    }
    .${TOOLBAR_CLASS} {
      position: fixed !important; inset: auto !important; display: none !important;
      gap: .25em !important; margin: 0 !important; padding: .2em !important;
      border: 1px solid color-mix(in srgb, CanvasText 12%, transparent) !important;
      border-radius: .45em !important; background: Canvas !important; color: CanvasText !important;
      box-shadow: 0 3px 14px color-mix(in srgb, CanvasText 22%, transparent) !important;
      z-index: 2147483647 !important;
    }
    .${TOOLBAR_CLASS}.is-visible { display: flex !important; }
    .${TOOLBAR_CLASS} button {
      appearance: auto !important; width: auto !important; min-width: 0 !important; margin: 0 !important;
      border: 1px solid color-mix(in srgb, CanvasText 16%, transparent) !important;
      border-radius: .3em !important; background: Canvas !important; color: CanvasText !important;
      font: 12px/1.2 system-ui !important; padding: .3em .55em !important; cursor: pointer !important;
    }
    html[data-ai-reader-display="translation"] body .${ORIGINAL_CLASS} { display: none !important; }
    html[data-ai-reader-display="original"] body .${ORIGINAL_CLASS} { opacity: 1 !important; }
    html[data-ai-reader-display="original"] body .${RESULT_CLASS} { display: none !important; }
  `
  document.head.append(style)
}

function ensureFloatingToolbar(): HTMLElement {
  if (floatingToolbar?.isConnected) return floatingToolbar
  const toolbar = document.createElement('div')
  toolbar.className = TOOLBAR_CLASS
  toolbar.dataset.aiReaderInserted = 'true'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', '译文操作')
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.textContent = '复制'
  copyButton.addEventListener('click', async () => {
    if (!toolbarState) return
    await navigator.clipboard.writeText(toolbarState.text)
    copyButton.textContent = '已复制'
    window.setTimeout(() => (copyButton.textContent = '复制'), 1200)
  })
  const retryButton = document.createElement('button')
  retryButton.type = 'button'
  retryButton.textContent = '重译'
  retryButton.addEventListener('click', () => {
    if (!toolbarState) return
    void chrome.runtime.sendMessage({
      type: 'RETRANSLATE_SEGMENT',
      segmentId: toolbarState.segmentId,
    })
    hideToolbar()
  })
  toolbar.append(copyButton, retryButton)
  toolbar.addEventListener('mouseenter', () => window.clearTimeout(hideToolbarTimer))
  toolbar.addEventListener('mouseleave', scheduleToolbarHide)
  document.documentElement.append(toolbar)
  window.addEventListener('scroll', hideToolbar, true)
  window.addEventListener('resize', hideToolbar)
  floatingToolbar = toolbar
  return toolbar
}

function attachFloatingToolbar(
  result: HTMLElement,
  segmentId: string,
  text: string,
): void {
  result.addEventListener('mouseenter', () => {
    window.clearTimeout(hideToolbarTimer)
    toolbarState = { segmentId, text }
    positionToolbar(result, ensureFloatingToolbar())
  })
  result.addEventListener('mouseleave', scheduleToolbarHide)
}

export function renderTranslation(
  segment: SemanticSegment,
  translatedText: string,
  showToolbar = true,
): boolean {
  ensureStyles()
  const original = resolveSegmentElement(segment)
  if (!original || !original.isConnected) return false
  original.classList.add(ORIGINAL_CLASS)
  original.dataset.aiReaderSegmentId = segment.id
  const existing = document.querySelector<HTMLElement>(
    `[data-ai-reader-for="${CSS.escape(segment.id)}"]`,
  )
  if (existing) existing.remove()
  const result = document.createElement('div')
  result.className = RESULT_CLASS
  result.dataset.aiReaderFor = segment.id
  result.dataset.aiReaderInserted = 'true'
  result.setAttribute('lang', 'zh-CN')
  const originalStyle = window.getComputedStyle(original)
  result.style.setProperty(
    'display',
    document.documentElement.dataset.aiReaderDisplay === 'original' ? 'none' : 'block',
    'important',
  )
  result.style.setProperty('visibility', 'visible', 'important')
  result.style.setProperty('opacity', '1', 'important')
  const root = document.documentElement
  const lineHeight = root.dataset.aiReaderTranslationLineHeight
  if (lineHeight) result.style.setProperty('line-height', lineHeight, 'important')
  if (originalStyle.fontSize && originalStyle.fontSize !== '0px') {
    result.style.setProperty('font-size', originalStyle.fontSize, 'important')
  }
  const paragraphs = translatedText
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean)
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [translatedText]) {
    const content = document.createElement(paragraphs.length > 1 ? 'p' : 'span')
    if (paragraphs.length > 1) content.className = 'ai-reader-translation-paragraph'
    content.textContent = paragraph
    result.append(content)
  }
  if (showToolbar) attachFloatingToolbar(result, segment.id, translatedText)
  original.insertAdjacentElement('afterend', result)
  return true
}

export function setDisplayMode(
  mode: DisplayMode,
  originalOpacity = 0.32,
  translationStyle: 'immersive' | 'highlight' = 'highlight',
  translationLineHeight: number | null = null,
  translationFont: 'default' | 'serif' | 'sans' = 'default',
): void {
  document.documentElement.dataset.aiReaderDisplay = mode
  document.documentElement.dataset.aiReaderTranslationStyle = translationStyle
  document.documentElement.dataset.aiReaderTranslationFont = translationFont
  if (translationLineHeight === null) {
    delete document.documentElement.dataset.aiReaderTranslationLineHeight
  } else {
    document.documentElement.dataset.aiReaderTranslationLineHeight = String(translationLineHeight)
  }
  document.documentElement.style.setProperty(
    '--ai-reader-original-opacity',
    String(Math.max(0.1, Math.min(1, originalOpacity))),
  )
  document.querySelectorAll<HTMLElement>(`.${RESULT_CLASS}`).forEach((result) => {
    result.style.setProperty('display', mode === 'original' ? 'none' : 'block', 'important')
    if (translationLineHeight === null) result.style.removeProperty('line-height')
    else result.style.setProperty('line-height', String(translationLineHeight), 'important')
  })
}

export function restoreOriginalPage(): void {
  window.clearTimeout(hideToolbarTimer)
  window.removeEventListener('scroll', hideToolbar, true)
  window.removeEventListener('resize', hideToolbar)
  document.querySelectorAll('[data-ai-reader-inserted]').forEach((node) => node.remove())
  floatingToolbar = null
  toolbarState = null
  document.querySelectorAll<HTMLElement>(`.${ORIGINAL_CLASS}`).forEach((element) => {
    element.classList.remove(ORIGINAL_CLASS)
    delete element.dataset.aiReaderSegmentId
  })
  delete document.documentElement.dataset.aiReaderDisplay
  delete document.documentElement.dataset.aiReaderTranslationStyle
  delete document.documentElement.dataset.aiReaderTranslationLineHeight
  delete document.documentElement.dataset.aiReaderTranslationFont
  document.documentElement.style.removeProperty('--ai-reader-original-opacity')
  document.getElementById(STYLE_ID)?.remove()
}
