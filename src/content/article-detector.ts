import type { ArticleRegionResult, SiteRule } from '../shared/types'

const PRIMARY_SELECTORS = ['article', 'main', '[role="main"]', '[role="article"]']
const SECONDARY_SELECTORS = [
  'section',
  '.post-content',
  '.article-content',
  '.entry-content',
  '.markdown-body',
  '.prose',
  '.content',
]
// A number of long-form sites (including hand-authored technical sites) use a
// generic wrapper around several sibling sections instead of an `<article>`
// or `<main>`. Keep these selectors explicit so that wrapper discovery does
// not depend on a particular framework's class naming convention.
const COMMON_CONTENT_SELECTORS = [
  '#content',
  '#main',
  '#article',
  '[itemprop="articleBody"]',
  '[class~="post"]',
  '[class~="entry"]',
  '[class*="article-content"]',
  '[class*="post-content"]',
  '[class*="entry-content"]',
  '[id*="content"]',
]
const NEGATIVE_PATTERN =
  /\b(nav|footer|aside|menu|form|dialog|comment|related|recommend|advert|promo|sidebar|breadcrumb|share|social)\b/i

export interface ArticleCandidateScore {
  element: HTMLElement
  score: number
  confidence: number
  textLength: number
  paragraphCount: number
  headingCount: number
  reasons: string[]
}

export function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  let current: HTMLElement | null = element
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    current = current.parentElement
  }
  return true
}

function normalizedText(element: Element): string {
  const clone = element.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll(
      'script,style,noscript,textarea,input,select,button,svg,canvas,video,audio,pre,code,[aria-hidden="true"],[data-ai-reader-inserted]',
    )
    .forEach((node) => node.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function visibleArea(element: HTMLElement): number {
  const rect = element.getBoundingClientRect()
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

const SEMANTIC_BLOCK_SELECTOR = 'p,li,blockquote,figcaption,dd,dt'

function countParagraphLikeElements(element: HTMLElement): number {
  const semanticCount = element.querySelectorAll(SEMANTIC_BLOCK_SELECTOR).length
  const genericCount = [...element.querySelectorAll<HTMLElement>('div')].filter((candidate) => {
    if (candidate.closest('[data-ai-reader-inserted]')) return false
    if (candidate.querySelector(SEMANTIC_BLOCK_SELECTOR)) return false
    if (candidate.querySelector('div')) return false
    return normalizedText(candidate).length >= 2
  }).length
  return semanticCount + genericCount
}

export function scoreArticleCandidate(element: HTMLElement): ArticleCandidateScore {
  const text = normalizedText(element)
  const textLength = text.length
  const paragraphCount = countParagraphLikeElements(element)
  const headingCount = element.querySelectorAll('h1,h2,h3,h4,h5,h6').length
  const sectionCount = element.querySelectorAll('section').length
  const linkText = [...element.querySelectorAll('a')].reduce(
    (total, link) => total + (link.textContent?.trim().length ?? 0),
    0,
  )
  const linkDensity = linkText / Math.max(1, textLength)
  const buttons = element.querySelectorAll('button,[role="button"]').length
  const forms = element.querySelectorAll('form,input,select,textarea').length
  const navigation = element.querySelectorAll('nav,aside,menu,[role="navigation"]').length
  const codeBlocks = element.querySelectorAll('pre,code').length
  const tagName = element.tagName.toLowerCase()
  const descriptor = `${element.id} ${element.className}`
  const area = visibleArea(element)
  const reasons: string[] = []

  let score = Math.min(45, Math.log2(Math.max(textLength, 1)) * 4)
  score += Math.min(25, paragraphCount * 2.2)
  score += Math.min(10, headingCount * 2)

  if (tagName === 'article' || element.getAttribute('role') === 'article') {
    score += 18
    reasons.push('使用文章语义标签')
  } else if (tagName === 'main' || element.getAttribute('role') === 'main') {
    score += 13
    reasons.push('使用主内容语义标签')
  }
  if (/\b(content|article|post|entry|story|prose|markdown)\b/i.test(descriptor)) {
    score += 5
    reasons.push('容器名称符合正文特征')
  }
  const hasMultiSectionStructure = sectionCount >= 2 && headingCount >= 2 && paragraphCount >= 4
  if (hasMultiSectionStructure) {
    score += Math.min(12, sectionCount * 2)
    reasons.push(`包含 ${sectionCount} 个文章章节`)
  }
  if (paragraphCount >= 5) reasons.push(`包含 ${paragraphCount} 个正文段落`)
  if (textLength >= 1200) reasons.push('可见正文内容充足')
  if (area > 250_000) score += 5
  if (codeBlocks > 0) {
    score += Math.min(5, codeBlocks)
    reasons.push('包含技术内容代码块')
  }

  // A table of contents can make the complete article wrapper link-heavy.
  // Do not let those internal links outweigh the stronger multi-section
  // structure signal; navigation-only candidates still receive the full
  // penalty below.
  score -= linkDensity * (hasMultiSectionStructure ? 14 : 55)
  score -= Math.min(20, buttons * 2.5)
  score -= Math.min(20, forms * 3)
  score -= Math.min(18, navigation * 4)
  if (NEGATIVE_PATTERN.test(descriptor) || ['NAV', 'FOOTER', 'ASIDE', 'FORM'].includes(element.tagName)) {
    score -= 30
    reasons.push('包含导航、评论或辅助区域特征')
  }
  if (linkDensity > 0.35) reasons.push('链接密度较高')

  const normalized = Math.max(0, Math.min(100, score))
  const sufficiency = Math.min(1, textLength / 1200) * 0.6 + Math.min(1, paragraphCount / 8) * 0.4
  return {
    element,
    score: normalized,
    confidence: Math.round((normalized / 100) * sufficiency * 100) / 100,
    textLength,
    paragraphCount,
    headingCount,
    reasons,
  }
}

export function collectArticleCandidates(root: ParentNode = document): HTMLElement[] {
  const candidates = new Set<HTMLElement>()
  for (const selector of [...PRIMARY_SELECTORS, ...SECONDARY_SELECTORS, ...COMMON_CONTENT_SELECTORS]) {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (isElementVisible(element) && normalizedText(element).length >= 120) {
        candidates.add(element)
      }
    })
  }

  // Also inspect large generic containers even when local `<section>`
  // candidates exist. Previously this fallback only ran for zero candidates,
  // causing a page composed of sibling sections to translate one section
  // (often just its heading) instead of the surrounding article wrapper.
  if (document.body && normalizedText(document.body).length >= 300) {
    const largeContainers = [...document.body.querySelectorAll<HTMLElement>('div')]
      .filter(
        (element) =>
          isElementVisible(element) &&
          normalizedText(element).length >= 250 &&
          countParagraphLikeElements(element) >= 3,
      )
      .sort((a, b) => normalizedText(b).length - normalizedText(a).length)
      .slice(0, 12)
    largeContainers.forEach((element) => candidates.add(element))
    if (candidates.size === 0 && largeContainers.length === 0) candidates.add(document.body)
  }
  return [...candidates]
}

export function getUniqueSelector(element: Element): string {
  if (element.id && !element.id.includes(' ')) return `#${CSS.escape(element.id)}`
  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== document.body && parts.length < 5) {
    let part = current.tagName.toLowerCase()
    const stableClasses = [...current.classList]
      .filter((name) => !name.startsWith('ai-reader-translation-'))
      .slice(0, 2)
    if (stableClasses.length > 0) part += stableClasses.map((name) => `.${CSS.escape(name)}`).join('')
    const parent: Element | null = current.parentElement
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === current?.tagName)
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    const selector = parts.join(' > ')
    if (document.querySelectorAll(selector).length === 1) return selector
    current = parent
  }
  return parts.join(' > ') || 'body'
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function toResult(candidate: ArticleCandidateScore): ArticleRegionResult {
  const selector = getUniqueSelector(candidate.element)
  return {
    selector,
    elementId: `article-region-${hashText(selector)}`,
    confidence: candidate.confidence,
    textLength: candidate.textLength,
    paragraphCount: candidate.paragraphCount,
    headingCount: candidate.headingCount,
    reasons: candidate.reasons,
  }
}

export function validateSiteRule(rule: SiteRule): HTMLElement | null {
  try {
    if (rule.hostname !== location.hostname) return null
    if (rule.pathnamePattern && !new RegExp(rule.pathnamePattern).test(location.pathname)) return null
    const matches = document.querySelectorAll<HTMLElement>(rule.selector)
    if (matches.length !== 1 || !isElementVisible(matches[0])) return null
    const score = scoreArticleCandidate(matches[0])
    return score.textLength >= 200 && score.paragraphCount >= 2 ? matches[0] : null
  } catch {
    return null
  }
}

export function detectArticleRegion(siteRules: SiteRule[] = []): ArticleRegionResult | null {
  for (const rule of siteRules) {
    const element = validateSiteRule(rule)
    if (element) {
      const result = toResult(scoreArticleCandidate(element))
      return { ...result, reasons: ['使用已保存的站点规则', ...result.reasons], confidence: 1 }
    }
  }

  const ranked = collectArticleCandidates()
    .map(scoreArticleCandidate)
    .sort((a, b) => b.score - a.score || b.textLength - a.textLength)
  if (ranked.length === 0) return null
  return toResult(ranked[0])
}

export function findRegionElement(result: ArticleRegionResult): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(result.selector)
  } catch {
    return null
  }
}
