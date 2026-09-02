import type { ArticleSnapshot, SemanticSegment, SiteRule } from '../shared/types'
import { messageSchema } from '../shared/messaging'
import { detectArticleRegion, findRegionElement, scoreArticleCandidate } from './article-detector'
import { extractSemanticSegments, resolveSegmentElement } from './segment-extractor'
import { startRegionPicker } from './advanced-region-picker'
import { observeArticleMutations } from './mutation-observer'
import { renderTranslation, restoreOriginalPage, setDisplayMode } from './translation-renderer'
import { validateCssSelector } from './selector-validator'
import { createExportArticle } from '../shared/export/article-exporter'
import { createArticleRegionCoverage } from '../shared/article-region-guard'

// This entry is bundled as a single classic script for Chrome content injection.
let snapshot: ArticleSnapshot | null = null
let customSelector: string | null = null
let ignoreSiteRules = false
let stopPicker: (() => void) | null = null
let stopObserver: (() => void) | null = null
let lastUrl = location.href

function getArticleTitle(root: HTMLElement): string {
  return root.querySelector('h1')?.textContent?.trim() || document.title
}

async function createSnapshot(): Promise<ArticleSnapshot | null> {
  let siteRules: SiteRule[] = []
  let autoUseSiteRules = true
  try {
    const config = (await chrome.runtime.sendMessage({ type: 'GET_CONTENT_CONFIG' })) as {
      ok: boolean
      siteRules?: SiteRule[]
      autoUseSiteRules?: boolean
    }
    siteRules = config.siteRules ?? []
    autoUseSiteRules = config.autoUseSiteRules ?? true
  } catch {
    // Detection still works when the service worker is waking up.
  }
  const matchingRules = autoUseSiteRules && !ignoreSiteRules
    ? siteRules.filter((rule) => rule.hostname === location.hostname)
    : []
  const automaticRegion = customSelector || matchingRules.length > 0
    ? detectArticleRegion([])
    : null
  const region = customSelector
    ? (() => {
        const element = document.querySelector<HTMLElement>(customSelector)
        if (!element) return null
        const scored = scoreArticleCandidate(element)
        return {
          selector: customSelector,
          elementId: `manual-${Date.now()}`,
          confidence: 1,
          textLength: scored.textLength,
          paragraphCount: scored.paragraphCount,
          headingCount: scored.headingCount,
          reasons: ['用户手动指定区域'],
        }
      })()
    : detectArticleRegion(matchingRules)
  if (!region) return null
  const root = findRegionElement(region)
  if (!root) return null
  const usedRule = region.reasons[0] === '使用已保存的站点规则'
  const regionSource: ArticleSnapshot['regionSource'] = customSelector
    ? 'manual'
    : usedRule
      ? 'site-rule'
      : 'automatic'
  const segments = extractSemanticSegments(root)
  const regionCoverage = regionSource !== 'automatic' && automaticRegion
    ? createArticleRegionCoverage(region, automaticRegion, segments)
    : undefined
  const regionWarning = regionCoverage?.requiresConfirmation
    ? `当前${regionSource === 'site-rule' ? '站点规则' : '手动区域'}仅覆盖自动正文候选的 ${Math.max(1, Math.round(regionCoverage.ratio * 100))}%，开始前需要确认翻译范围。`
    : undefined
  stopObserver?.()
  stopObserver = observeArticleMutations(root, () => {
    const known = new Set(snapshot?.segments.map((segment) => segment.id) ?? [])
    const next = extractSemanticSegments(root)
    const added = next.filter((segment) => !known.has(segment.id))
    if (snapshot && added.length > 0) snapshot = { ...snapshot, segments: next }
  })
  snapshot = {
    region,
    regionSource,
    regionWarning,
    regionCoverage,
    segments,
    pageTitle: document.title,
    articleTitle: getArticleTitle(root),
    url: location.href,
    siteRuleWarning:
      matchingRules.length > 0 && !usedRule ? '已保存的站点规则失效，已退回自动识别' : undefined,
  }
  return snapshot
}

function findSegment(segmentId: string): SemanticSegment | undefined {
  return snapshot?.segments.find((segment) => segment.id === segmentId)
}

function findSegmentForRender(
  segmentId: string,
  fallback?: SemanticSegment,
): SemanticSegment | undefined {
  const known = findSegment(segmentId)
  if (known && resolveSegmentElement(known)) return known
  if (fallback && resolveSegmentElement(fallback)) return fallback
  if (!snapshot) return fallback
  const root = findRegionElement(snapshot.region)
  if (!root) return fallback
  const refreshed = extractSemanticSegments(root)
  snapshot = { ...snapshot, segments: refreshed }
  const exact = refreshed.find((segment) => segment.id === segmentId)
  if (exact) return exact
  if (!fallback) return undefined
  const candidates = refreshed
    .filter((segment) => segment.tagName === fallback.tagName && segment.sourceText === fallback.sourceText)
    .sort((left, right) => Math.abs(left.order - fallback.order) - Math.abs(right.order - fallback.order))
  const recovered = candidates[0]
  return recovered ? { ...recovered, id: segmentId } : undefined
}

function renderSegment(
  segmentId: string,
  translatedText: string,
  showToolbar?: boolean,
  fallback?: SemanticSegment,
): boolean {
  const segment = findSegmentForRender(segmentId, fallback)
  return Boolean(segment && renderTranslation(segment, translatedText, showToolbar))
}

function findRenderedTranslation(segmentId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-ai-reader-for="${CSS.escape(segmentId)}"]`,
  )
}

function isRenderedTranslationVisible(segmentId: string): boolean {
  const result = findRenderedTranslation(segmentId)
  if (!result?.isConnected || !result.textContent?.trim()) return false
  let current: HTMLElement | null = result
  while (current) {
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    current = current.parentElement
  }
  return result.getClientRects().length > 0
}

function waitForPageCommit(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 80))
}

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const parsed = messageSchema.safeParse(raw)
  if (!parsed.success) {
    sendResponse({ ok: false, error: '消息格式不合法' })
    return false
  }
  const message = parsed.data
  void (async () => {
    switch (message.type) {
      case 'DETECT_ARTICLE':
      case 'GET_PAGE_STATE': {
        sendResponse({ ok: true, snapshot: await createSnapshot() })
        break
      }
      case 'RESET_ARTICLE_REGION': {
        customSelector = null
        ignoreSiteRules = true
        sendResponse({ ok: true, snapshot: await createSnapshot() })
        break
      }
      case 'PREPARE_ARTICLE_EXPORT': {
        const current = snapshot ?? await createSnapshot()
        if (!current) throw new Error('文章主体不存在')
        const root = findRegionElement(current.region)
        if (!root) throw new Error('文章主体已被页面移除')
        const article = createExportArticle({
          root,
          rootElementPath: current.region.selector,
          segments: current.segments,
          title: current.articleTitle,
          sourceUrl: current.url,
          targetLanguage: message.targetLanguage,
          exportMode: message.contentMode,
        })
        if (article.blocks.length === 0) throw new Error('文章内容为空')
        sendResponse({ ok: true, article })
        break
      }
      case 'VALIDATE_SELECTOR': {
        sendResponse({ ok: true, result: validateCssSelector(message.selector) })
        break
      }
      case 'PREVIEW_SELECTOR': {
        const validation = validateCssSelector(message.selector)
        if (validation.valid) {
          document.querySelector<HTMLElement>(message.selector)?.scrollIntoView({
            behavior: 'smooth', block: 'center',
          })
        }
        sendResponse({ ok: validation.valid, result: validation })
        break
      }
      case 'USE_SELECTOR': {
        const validation = validateCssSelector(message.selector)
        if (!validation.valid) {
          sendResponse({ ok: false, error: validation.message })
          break
        }
        customSelector = message.selector
        ignoreSiteRules = false
        sendResponse({ ok: true, snapshot: await createSnapshot() })
        break
      }
      case 'START_REGION_PICKER': {
        stopPicker?.()
        stopPicker = startRegionPicker(
          (selector) => {
            customSelector = selector
            ignoreSiteRules = false
            void chrome.runtime.sendMessage({ type: 'REGION_SELECTED', selector })
          },
          () => void chrome.runtime.sendMessage({ type: 'REGION_PICKER_CANCELLED' }),
        )
        sendResponse({ ok: true })
        break
      }
      case 'CANCEL_REGION_PICKER': {
        stopPicker?.()
        stopPicker = null
        sendResponse({ ok: true })
        break
      }
      case 'RENDER_TRANSLATION': {
        const rendered = renderSegment(
          message.segmentId,
          message.translatedText,
          message.showToolbar,
          message.segment,
        )
        sendResponse({
          ok: rendered,
          error: rendered ? undefined : '找不到译文对应的当前页面段落',
        })
        break
      }
      case 'RENDER_TRANSLATIONS': {
        setDisplayMode(message.mode, message.opacity, message.translationStyle, message.translationLineHeight, message.translationFont)
        let renderedCount = 0
        for (const item of message.translations) {
          if (renderSegment(item.segmentId, item.translatedText, message.showToolbar, item.segment)) {
            renderedCount += 1
          }
        }
        await waitForPageCommit()
        const detachedItems = message.translations.filter(
          (item) => !findRenderedTranslation(item.segmentId)?.isConnected,
        )
        for (const item of detachedItems) {
          renderSegment(item.segmentId, item.translatedText, message.showToolbar, item.segment)
        }
        if (detachedItems.length > 0) await waitForPageCommit()
        const failedSegmentIds = message.translations
          .filter((item) => !findRenderedTranslation(item.segmentId)?.isConnected)
          .map((item) => item.segmentId)
        const hiddenSegmentIds = message.mode === 'original'
          ? []
          : message.translations
              .filter((item) => !failedSegmentIds.includes(item.segmentId))
              .filter((item) => !isRenderedTranslationVisible(item.segmentId))
              .map((item) => item.segmentId)
        const attachedCount = message.translations.length - failedSegmentIds.length
        const visibleCount = message.mode === 'original'
          ? 0
          : attachedCount - hiddenSegmentIds.length
        sendResponse({
          ok: failedSegmentIds.length === 0 && hiddenSegmentIds.length === 0,
          renderedCount,
          attachedCount,
          visibleCount,
          failedSegmentIds,
          hiddenSegmentIds,
          error: failedSegmentIds.length > 0
            ? `${failedSegmentIds.length} 个译文段落插入后被页面移除`
            : hiddenSegmentIds.length > 0
              ? `${hiddenSegmentIds.length} 个译文段落被页面样式隐藏`
              : undefined,
        })
        break
      }
      case 'SET_DISPLAY_MODE': {
        setDisplayMode(message.mode, message.opacity, message.translationStyle, message.translationLineHeight, message.translationFont)
        sendResponse({ ok: true })
        break
      }
      case 'RESTORE_PAGE': {
        stopObserver?.()
        stopObserver = null
        restoreOriginalPage()
        sendResponse({ ok: true })
        break
      }
      default:
        sendResponse({ ok: false, error: '此消息不由页面处理' })
    }
  })().catch((error: unknown) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : '页面处理失败' })
  })
  return true
})

async function initializeDetection(): Promise<void> {
  if (await createSnapshot()) return
  let timer: number | undefined
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      void createSnapshot().then((result) => {
        if (result) observer.disconnect()
      })
    }, 500)
  })
  if (document.body) observer.observe(document.body, { childList: true, subtree: true })
  window.setTimeout(() => observer.disconnect(), 15_000)
}

window.setInterval(() => {
  if (location.href === lastUrl) return
  lastUrl = location.href
  customSelector = null
  ignoreSiteRules = false
  snapshot = null
  stopObserver?.()
  void chrome.runtime.sendMessage({ type: 'PAGE_NAVIGATED', url: lastUrl })
  void initializeDetection()
}, 1000)

void initializeDetection()
