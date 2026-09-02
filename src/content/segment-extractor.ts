import type { SemanticSegment } from '../shared/types'
import { getUniqueSelector, isElementVisible } from './article-detector'

export const SEMANTIC_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th,dt,dd'
export const IGNORED_SELECTOR =
  'script,style,noscript,textarea,input,select,option,button,svg,canvas,video,audio,code,pre,kbd,samp,[aria-hidden="true"],[data-ai-reader-inserted]'
const GENERIC_TEXT_BLOCK_SELECTOR = 'div'

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function extractElementText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll(IGNORED_SELECTOR).forEach((node) => node.remove())
  return normalizeText(clone.textContent ?? '')
}

function isMeaningfulText(text: string): boolean {
  if (text.length < 2) return false
  if (/^[\d\s.,:%+\-–—/()]+$/.test(text)) return false
  if (/^(https?:\/\/|www\.)\S+$/i.test(text)) return false
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(text)) return false
  return true
}

function hasIgnoredAncestor(element: Element, root: HTMLElement): boolean {
  const ignored = element.closest(IGNORED_SELECTOR)
  return Boolean(ignored && root.contains(ignored))
}

/**
 * Some hand-authored articles use plain divs as paragraphs. Treat only leaf
 * divs as text blocks so that a wrapper around several blocks is not emitted
 * again as a duplicate segment.
 */
function isGenericTextBlock(element: HTMLElement, root: HTMLElement): boolean {
  if (element.tagName !== 'DIV' || !root.contains(element)) return false
  if (element.querySelector(SEMANTIC_SELECTOR)) return false
  if (element.querySelector(GENERIC_TEXT_BLOCK_SELECTOR)) return false
  return isMeaningfulText(extractElementText(element))
}

function stableHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

export function createSegmentId(
  elementPath: string,
  sourceText: string,
  pageUrl = location.href,
): string {
  const stableUrl = pageUrl.split('#')[0]
  return `segment-${stableHash(`${stableUrl}|${elementPath}|${sourceText}`)}`
}

export function extractSemanticSegments(root: HTMLElement): SemanticSegment[] {
  const headings = new Map<number, string>()
  const segments: SemanticSegment[] = []
  const elements = [
    ...root.querySelectorAll<HTMLElement>(SEMANTIC_SELECTOR),
    ...[...root.querySelectorAll<HTMLElement>(GENERIC_TEXT_BLOCK_SELECTOR)]
      .filter((element) => isGenericTextBlock(element, root)),
  ]
  if (root.matches(SEMANTIC_SELECTOR)) elements.unshift(root)
  else if (isGenericTextBlock(root, root)) elements.unshift(root)

  // querySelectorAll calls above produce separate lists; restore document
  // order so heading context and segment ordering remain stable.
  elements.sort((left, right) => {
    if (left === right) return 0
    const position = left.compareDocumentPosition(right)
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })

  for (const element of elements) {
    if (!isElementVisible(element) || hasIgnoredAncestor(element, root)) continue
    if (element.closest('[data-ai-reader-inserted]')) continue
    const text = extractElementText(element)
    if (!isMeaningfulText(text)) continue

    const headingMatch = /^H([1-6])$/.exec(element.tagName)
    if (headingMatch) {
      const level = Number(headingMatch[1])
      headings.set(level, text)
      for (let deeper = level + 1; deeper <= 6; deeper += 1) headings.delete(deeper)
    }

    const elementPath = getUniqueSelector(element)
    const headingContext = [...headings.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, value]) => value)
    segments.push({
      id: createSegmentId(elementPath, text),
      tagName: element.tagName.toLowerCase(),
      sourceText: text,
      elementPath,
      headingContext,
      order: segments.length,
    })
  }
  return segments
}

export function resolveSegmentElement(segment: SemanticSegment): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>(
    `[data-ai-reader-segment-id="${CSS.escape(segment.id)}"]`,
  )
  if (marked?.isConnected && extractElementText(marked) === segment.sourceText) return marked
  try {
    const exact = document.querySelector<HTMLElement>(segment.elementPath)
    if (exact && extractElementText(exact) === segment.sourceText) return exact
  } catch {
    // Fall through to text-based recovery for SPA DOM replacements.
  }
  const candidates = [...document.querySelectorAll<HTMLElement>(segment.tagName)]
    .filter((element) => !element.closest('[data-ai-reader-inserted]'))
    .filter((element) => extractElementText(element) === segment.sourceText)
  return candidates.length === 1 ? candidates[0] : null
}
