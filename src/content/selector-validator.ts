import { extractSemanticSegments } from './segment-extractor'
import { isElementVisible, scoreArticleCandidate } from './article-detector'

export interface SelectorValidationResult {
  valid: boolean
  matchCount: number
  message: string
  selector: string
  textLength?: number
  paragraphCount?: number
}

export function validateCssSelector(selector: string): SelectorValidationResult {
  const trimmed = selector.trim()
  if (!trimmed) return { valid: false, matchCount: 0, message: '请输入 CSS 选择器', selector: trimmed }
  let matches: NodeListOf<HTMLElement>
  try {
    matches = document.querySelectorAll<HTMLElement>(trimmed)
  } catch {
    return { valid: false, matchCount: 0, message: 'CSS 选择器格式不合法', selector: trimmed }
  }
  if (matches.length === 0) {
    return { valid: false, matchCount: 0, message: '没有找到匹配的元素', selector: trimmed }
  }
  if (matches.length > 1) {
    return {
      valid: false,
      matchCount: matches.length,
      message: `找到 ${matches.length} 个元素，请使用更精确的选择器`,
      selector: trimmed,
    }
  }
  const element = matches[0]
  if (!isElementVisible(element)) {
    return { valid: false, matchCount: 1, message: '匹配的元素不可见', selector: trimmed }
  }
  const score = scoreArticleCandidate(element)
  const paragraphs = extractSemanticSegments(element).length
  if (score.textLength < 120 || paragraphs < 2) {
    return {
      valid: false,
      matchCount: 1,
      message: '匹配元素的正文内容过少',
      selector: trimmed,
      textLength: score.textLength,
      paragraphCount: paragraphs,
    }
  }
  return {
    valid: true,
    matchCount: 1,
    message: '区域可用',
    selector: trimmed,
    textLength: score.textLength,
    paragraphCount: paragraphs,
  }
}
