import type { SemanticSegment } from '../shared/types'
import { getUniqueSelector, isElementVisible } from './article-detector'
import {
  extractNodesText, getTextRuns, IGNORED_SELECTOR, isMeaningfulText,
  SEMANTIC_SELECTOR, SOURCE_WRAPPER_SELECTOR, TEXT_BOUNDARY_SELECTOR, TEXT_CONTAINER_SELECTOR,
} from '../shared/text-runs'

export { IGNORED_SELECTOR, SEMANTIC_SELECTOR } from '../shared/text-runs'
const GENERIC_TEXT_BLOCK_SELECTOR = 'div'

export function extractElementText(element: HTMLElement): string {
  return extractNodesText([element])
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
  if (element.querySelector(`${TEXT_BOUNDARY_SELECTOR},${SOURCE_WRAPPER_SELECTOR}`)) return false
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

  const blocks = elements.map((element) => ({
    element,
    anchor: element as Node,
    text: extractElementText(element),
    textRun: undefined as number | undefined,
  }))
  const wholeBlocks = new Set(elements)
  for (const container of [root, ...root.querySelectorAll<HTMLElement>(TEXT_CONTAINER_SELECTOR)]) {
    if (wholeBlocks.has(container) || !isElementVisible(container) || hasIgnoredAncestor(container, root)) continue
    // Semantic blocks already own their inline contents (e.g. a div inside a li).
    const semanticParent = container.closest(SEMANTIC_SELECTOR)
    if (semanticParent && root.contains(semanticParent)) continue
    getTextRuns(container).forEach((run, textRun) => {
      blocks.push({ element: container, anchor: run.nodes[0], text: run.text, textRun })
    })
  }

  // querySelectorAll calls above produce separate lists; restore document
  // order so heading context and segment ordering remain stable.
  blocks.sort((left, right) => {
    if (left.anchor === right.anchor) return 0
    const position = left.anchor.compareDocumentPosition(right.anchor)
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })

  for (const { element, text, textRun } of blocks) {
    if (!isElementVisible(element) || hasIgnoredAncestor(element, root)) continue
    if (element.closest('[data-ai-reader-inserted]')) continue
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
      id: createSegmentId(textRun === undefined ? elementPath : `${elementPath}::text-run(${textRun})`, text),
      tagName: element.tagName.toLowerCase(),
      sourceText: text,
      elementPath,
      ...(textRun === undefined ? {} : { textRun }),
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
    if (segment.textRun !== undefined) {
      if (exact && getTextRuns(exact)[segment.textRun]?.text === segment.sourceText) return exact
      return null
    }
    if (exact && extractElementText(exact) === segment.sourceText) return exact
  } catch {
    // Fall through to text-based recovery for SPA DOM replacements.
  }
  if (segment.textRun !== undefined) return null
  const candidates = [...document.querySelectorAll<HTMLElement>(segment.tagName)]
    .filter((element) => !element.closest('[data-ai-reader-inserted]'))
    .filter((element) => extractElementText(element) === segment.sourceText)
  return candidates.length === 1 ? candidates[0] : null
}
