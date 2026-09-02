import { getUniqueSelector, isElementVisible, scoreArticleCandidate } from './article-detector'

const ALLOWED_TAGS = new Set(['ARTICLE', 'MAIN', 'SECTION', 'HEADER'])
const DISALLOWED_TAGS = new Set([
  'SPAN', 'A', 'BUTTON', 'STRONG', 'EM', 'SVG', 'P', 'LI', 'INPUT', 'TEXTAREA', 'CODE', 'PRE',
])

function isEligible(element: HTMLElement): boolean {
  if (!isElementVisible(element) || DISALLOWED_TAGS.has(element.tagName)) return false
  const score = scoreArticleCandidate(element)
  if (element.tagName === 'HEADER' && !element.closest('article,main,[role="article"]')) return false
  return (
    ALLOWED_TAGS.has(element.tagName) ||
    element.matches('[role="main"],[role="article"]') ||
    (score.textLength >= 500 && score.paragraphCount >= 3)
  )
}

export function findEligibleRegion(target: EventTarget | null): HTMLElement | null {
  let element = target instanceof HTMLElement ? target : null
  while (element && element !== document.body) {
    if (isEligible(element)) return element
    element = element.parentElement
  }
  return null
}

export function startRegionPicker(
  onSelect: (selector: string) => void,
  onCancel: () => void,
): () => void {
  const overlay = document.createElement('div')
  overlay.dataset.aiReaderInserted = 'true'
  overlay.style.cssText =
    'position:fixed;pointer-events:none;border:3px solid #4f7cff;background:#4f7cff18;z-index:2147483646;display:none;transition:all 60ms linear'
  const label = document.createElement('div')
  label.dataset.aiReaderInserted = 'true'
  label.style.cssText =
    'position:fixed;pointer-events:none;background:#111827;color:white;padding:6px 9px;border-radius:6px;font:12px system-ui;z-index:2147483647;display:none;max-width:70vw'
  document.documentElement.append(overlay, label)
  let active: HTMLElement | null = null

  const update = (event: MouseEvent) => {
    active = findEligibleRegion(event.target)
    if (!active) {
      overlay.style.display = 'none'
      label.style.display = 'none'
      return
    }
    const rect = active.getBoundingClientRect()
    const score = scoreArticleCandidate(active)
    Object.assign(overlay.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    })
    label.textContent = `${active.tagName.toLowerCase()} · ${score.paragraphCount} 段 · ${score.textLength} 字符`
    Object.assign(label.style, {
      display: 'block', left: `${Math.max(8, rect.left)}px`, top: `${Math.max(8, rect.top - 32)}px`,
    })
  }
  const cleanup = () => {
    document.removeEventListener('mousemove', update, true)
    document.removeEventListener('click', click, true)
    document.removeEventListener('keydown', keydown, true)
    overlay.remove()
    label.remove()
  }
  const click = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!active) return
    const selector = getUniqueSelector(active)
    cleanup()
    onSelect(selector)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    cleanup()
    onCancel()
  }
  document.addEventListener('mousemove', update, true)
  document.addEventListener('click', click, true)
  document.addEventListener('keydown', keydown, true)
  return cleanup
}
