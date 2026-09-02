import { messageSchema } from '../shared/messaging'
import { createProvider } from '../shared/api/provider-factory'
import { analyzeArticle } from '../shared/translation/article-analyzer'
import { createTranslationChunks } from '../shared/translation/chunker'
import { TranslationCache } from '../shared/translation/cache'
import { mergeSegmentTranslations, updateTranslationMemory } from '../shared/translation/context-window'
import { PRECISION_PIPELINE_VERSION, translateChunk } from '../shared/translation/pipeline'
import {
  getProviders,
  getSettings,
  getExportTasks,
  saveExportTasks,
  saveSiteRules,
  getSiteRules,
} from '../shared/storage'
import type {
  ArticleContext,
  ArticleSnapshot,
  ProviderRequestTelemetryEvent,
  ProviderConfig,
  SegmentTranslation,
  SiteRule,
  TranslationChunk,
  TranslationTaskState,
  UserSettings,
} from '../shared/types'
import {
  getTaskForTab,
  persistTask,
  removeTaskForTab,
  taskStateReducer,
} from './task-manager'
import {
  clearDiagnosticLogs,
  diagnosticErrorDetails,
  getDiagnosticLogs,
  writeDiagnosticLog,
} from './diagnostics'
import type { ExportTaskState } from '../shared/export/export-types'
import { articleExportOptionsSchema, exportArticleSchema } from '../shared/export/export-schemas'
import { ExportError } from '../shared/export/export-types'
import { executeArticleExport } from './export-manager'
import { requiresArticleRegionConfirmation } from '../shared/article-region-guard'

const controllers = new Map<number, AbortController>()
const contexts = new Map<number, ArticleContext>()
const exportControllers = new Map<number, { taskId: string; controller: AbortController }>()

function isMissingContentScriptError(error: unknown): boolean {
  return error instanceof Error && /Receiving end does not exist|Could not establish connection|message port closed/i.test(error.message)
}

function isPageAccessError(error: unknown): boolean {
  return error instanceof Error && /Cannot access contents of the page|manifest must request permission|The extensions gallery cannot be scripted/i.test(error.message)
}

function waitForContentScript(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

/**
 * Existing tabs are not reinjected when an MV3 extension is reloaded. The
 * side panel can therefore ask the service worker to restore a task before a
 * content-script receiver exists. Retry the race first, then inject the
 * bundled script when Chrome confirms that no receiver is present.
 */
async function sendContentMessage<T>(tabId: number, message: object): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message) as T
    } catch (error) {
      lastError = error
      if (!isMissingContentScriptError(error)) throw error
      await waitForContentScript(100)
    }
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await waitForContentScript(100)
    return await chrome.tabs.sendMessage(tabId, message) as T
  } catch (error) {
    if (isPageAccessError(error)) {
      throw new Error('当前页面不允许扩展访问，无法恢复持久化译文。请在普通 HTTP/HTTPS 文章页面中打开扩展。', { cause: error })
    }
    if (isMissingContentScriptError(error) && lastError instanceof Error) throw lastError
    throw error
  }
}

void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

async function notifyTask(task: TranslationTaskState): Promise<void> {
  await persistTask(task)
  try {
    await chrome.runtime.sendMessage({ type: 'TASK_UPDATED', task })
  } catch {
    // Side Panel may be closed. State is persisted for the next open.
  }
}

async function notifyExportTask(task: ExportTaskState): Promise<void> {
  const tasks = await getExportTasks()
  tasks[String(task.tabId)] = task
  await saveExportTasks(tasks)
  try {
    await chrome.runtime.sendMessage({ type: 'EXPORT_UPDATED', task })
  } catch {
    // Side Panel may be closed; progress remains persisted.
  }
}

async function getExportTask(tabId: number): Promise<ExportTaskState | null> {
  const tasks = await getExportTasks()
  return tasks[String(tabId)] ?? null
}

function createExportTask(tabId: number, filename: string, pageUrl: string): ExportTaskState {
  const now = Date.now()
  return {
    taskId: crypto.randomUUID(),
    tabId,
    pageUrl,
    status: 'preparing',
    stage: '正在准备导出',
    filename,
    totalMedia: 0,
    completedMedia: 0,
    failedMedia: 0,
    downloadedBytes: 0,
    incompleteTranslation: false,
    createdAt: now,
    updatedAt: now,
  }
}

function runExportTask(
  task: ExportTaskState,
  article: unknown,
  options: unknown,
  translations?: TranslationTaskState['translations'],
): void {
  exportControllers.get(task.tabId)?.controller.abort()
  const controller = new AbortController()
  exportControllers.set(task.tabId, { taskId: task.taskId, controller })
  void executeArticleExport({
    task,
    article,
    options,
    translations,
    signal: controller.signal,
    onUpdate: notifyExportTask,
  }).catch(async (error: unknown) => {
    const cancelled = controller.signal.aborted || (error instanceof ExportError && error.code === 'EXPORT_CANCELLED')
    const current = await getExportTask(task.tabId) ?? task
    await notifyExportTask({
      ...current,
      status: cancelled ? 'cancelled' : 'failed',
      stage: cancelled ? '导出已取消' : '导出失败',
      errorCode: cancelled
        ? 'EXPORT_CANCELLED'
        : error instanceof ExportError ? error.code : 'UNKNOWN',
      error: cancelled ? undefined : error instanceof Error ? error.message : '导出失败',
      updatedAt: Date.now(),
    })
  }).finally(() => {
    if (exportControllers.get(task.tabId)?.taskId === task.taskId) exportControllers.delete(task.tabId)
  })
}

async function getSnapshot(tabId: number): Promise<ArticleSnapshot> {
  const response = await sendContentMessage<{ ok: boolean; snapshot?: ArticleSnapshot; error?: string }>(tabId, {
    type: 'GET_PAGE_STATE',
  })
  if (!response.ok || !response.snapshot) {
    throw new Error(response.error ?? '未能可靠识别文章主体')
  }
  if (response.snapshot.region.confidence < 0.2) {
    throw new Error('未能可靠识别文章主体，请在高级模式中选择区域')
  }
  return response.snapshot
}

interface PageRenderResult {
  ok?: boolean
  renderedCount?: number
  attachedCount?: number
  visibleCount?: number
  failedSegmentIds?: string[]
  hiddenSegmentIds?: string[]
  error?: string
}

async function renderTranslationsToPage(input: {
  tabId: number
  translations: SegmentTranslation[]
  segments?: ArticleSnapshot['segments']
  showToolbar: boolean
  mode: TranslationTaskState['displayMode']
  opacity: number
  translationStyle: UserSettings['translationDisplayStyle']
  translationLineHeight: UserSettings['translationLineHeight']
  translationFont: UserSettings['translationFont']
}): Promise<PageRenderResult> {
  const segmentById = new Map(input.segments?.map((segment) => [segment.id, segment]) ?? [])
  return sendContentMessage<PageRenderResult>(input.tabId, {
    type: 'RENDER_TRANSLATIONS',
    translations: input.translations.map((translation) => ({
      segmentId: translation.id,
      translatedText: translation.translatedText,
      segment: segmentById.get(translation.id),
    })),
    showToolbar: input.showToolbar,
    mode: input.mode,
    opacity: input.opacity,
    translationStyle: input.translationStyle,
    translationLineHeight: input.translationLineHeight,
    translationFont: input.translationFont,
  }) as Promise<PageRenderResult>
}

async function resolveProvider(providerId?: string): Promise<ProviderConfig> {
  const providers = await getProviders()
  const settings = await getSettings()
  const id = providerId || settings.defaultProviderId
  const provider = providers.find((item) => item.id === id) ?? providers[0]
  if (!provider) throw new Error('尚未配置模型 Provider，请先打开扩展设置')
  return provider
}

function createTask(
  tabId: number,
  snapshot: ArticleSnapshot,
  provider: ProviderConfig,
  chunks: TranslationChunk[],
): TranslationTaskState {
  const now = Date.now()
  return {
    taskId: crypto.randomUUID(),
    tabId,
    pageUrl: snapshot.url,
    articleSelector: snapshot.region.selector,
    status: 'analyzing',
    currentStage: '分析文章主题、术语和语气',
    totalSegments: snapshot.segments.length,
    completedSegments: 0,
    failedSegments: 0,
    pendingChunkIds: chunks.map((chunk) => chunk.id),
    completedChunkIds: [],
    failedChunkIds: [],
    totalChunks: chunks.length,
    currentChunkIndex: 0,
    chunkProgress: chunks.map((chunk, index) => ({
      chunkId: chunk.id,
      index: index + 1,
      segmentCount: chunk.segmentIds.length,
      status: 'pending',
    })),
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.type,
    model: provider.model,
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    displayMode: 'bilingual',
    originalOpacity: 0.32,
    translationMemory: [],
    translations: [],
    telemetry: {
      startedAt: now,
      stageStartedAt: now,
      lastActivityAt: now,
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      retryCount: 0,
      slowRequestCount: 0,
      totalLatencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      completedChunkDurationMs: 0,
    },
    createdAt: now,
    updatedAt: now,
  }
}

async function runTask(tabId: number, existing?: TranslationTaskState): Promise<void> {
  const controller = new AbortController()
  controllers.get(tabId)?.abort()
  controllers.set(tabId, controller)
  let task = existing
  let taskWriteQueue: Promise<void> = Promise.resolve()
  const saveTask = (nextTask: TranslationTaskState): Promise<void> => {
    const snapshot = structuredClone(nextTask)
    taskWriteQueue = taskWriteQueue.catch(() => undefined).then(async () => {
      if (controller.signal.aborted || controllers.get(tabId) !== controller) return
      await notifyTask(snapshot)
    })
    return taskWriteQueue
  }
  const stageWatchdogs = new Map<string, ReturnType<typeof setTimeout>>()
  const log = (
    level: 'info' | 'warn' | 'error',
    scope: 'task' | 'provider' | 'pipeline' | 'render' | 'lifecycle',
    message: string,
    details?: Record<string, string | number | boolean | null>,
  ) => writeDiagnosticLog({ level, scope, message, details, tabId, taskId: task?.taskId })
  const recordProviderTelemetry = (event: ProviderRequestTelemetryEvent) => {
    if (!task || controller.signal.aborted || controllers.get(tabId) !== controller) return
    task = taskStateReducer(task, { type: 'PROVIDER_TELEMETRY', event })
    void saveTask(task)
    const message = event.type === 'request-started'
      ? '模型请求已创建'
      : event.type === 'attempt-started'
        ? `模型请求第 ${event.attempt} / ${event.maxAttempts} 次尝试`
        : event.type === 'response-received'
          ? `模型服务返回 HTTP ${event.status}`
          : event.type === 'retry-scheduled'
            ? `模型请求将在 ${Math.ceil((event.retryDelayMs ?? 0) / 100) / 10} 秒后重试`
            : event.type === 'request-completed'
              ? '模型请求完成'
              : '模型请求失败'
    const level = event.type === 'request-failed'
      ? 'error'
      : event.type === 'retry-scheduled' || (event.elapsedMs >= 15_000 && event.type === 'request-completed')
        ? 'warn'
        : 'info'
    void writeDiagnosticLog({
      level,
      scope: 'provider',
      message,
      tabId,
      taskId: task.taskId,
      requestId: event.requestId,
      chunkId: task.currentChunkId,
      operation: event.operation,
      details: {
        attempt: event.attempt ?? null,
        maxAttempts: event.maxAttempts,
        timeoutMs: event.timeoutMs,
        elapsedMs: event.elapsedMs,
        attemptElapsedMs: event.attemptElapsedMs ?? null,
        httpStatus: event.status ?? null,
        retryDelayMs: event.retryDelayMs ?? null,
        errorCode: event.errorCode ?? null,
        inputTokens: event.inputTokens ?? null,
        outputTokens: event.outputTokens ?? null,
        totalTokens: event.totalTokens ?? null,
      },
    })
  }
  await log('info', 'task', existing ? '准备恢复翻译任务' : '收到开始精译请求', {
    resumed: Boolean(existing),
  })
  try {
    const [snapshot, settings] = await Promise.all([getSnapshot(tabId), getSettings()])
    const providerConfig = await resolveProvider(existing?.providerId)
    const provider = createProvider(providerConfig)
    const chunks = createTranslationChunks(snapshot.segments, {
      maxTokens: settings.maxChunkTokens,
    })
    if (!task || task.pageUrl !== snapshot.url) {
      task = createTask(tabId, snapshot, providerConfig, chunks)
    } else {
      const oldProgress = new Map(task.chunkProgress?.map((chunk) => [chunk.chunkId, chunk]) ?? [])
      const now = Date.now()
      task = {
        ...task,
        failedSegments: 0,
        failedChunkIds: [],
        error: undefined,
        totalChunks: chunks.length,
        chunkProgress: chunks.map((chunk, index) => {
          const previous = oldProgress.get(chunk.id)
          return task!.completedChunkIds.includes(chunk.id) && previous
            ? previous
            : {
                chunkId: chunk.id,
                index: index + 1,
                segmentCount: chunk.segmentIds.length,
                status: 'pending' as const,
              }
        }),
        telemetry: task.telemetry ? {
          ...task.telemetry,
          activeRequest: undefined,
          stageStartedAt: now,
          lastActivityAt: now,
        } : {
          startedAt: task.createdAt,
          stageStartedAt: now,
          lastActivityAt: now,
          totalRequests: 0,
          completedRequests: 0,
          failedRequests: 0,
          retryCount: 0,
          slowRequestCount: 0,
          totalLatencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          completedChunkDurationMs: 0,
        },
      }
      task = taskStateReducer(task, {
        type: 'RESET_PENDING',
        chunkIds: chunks
          .filter((chunk) => !task!.completedChunkIds.includes(chunk.id))
          .map((chunk) => chunk.id),
      })
      task = taskStateReducer(task, { type: 'SET_STATUS', status: 'analyzing' })
    }
    task.targetLanguage = settings.defaultTargetLanguage
    task.displayMode = settings.displayMode
    task.originalOpacity = settings.originalOpacity
    task.providerName = providerConfig.name
    task.providerType = providerConfig.type
    task.model = providerConfig.model
    await saveTask(task)
    await log('info', 'task', '任务配置完成', {
      segmentCount: snapshot.segments.length,
      characterCount: snapshot.region.textLength,
      chunkCount: chunks.length,
      providerType: providerConfig.type,
      model: providerConfig.model,
      maxChunkTokens: settings.maxChunkTokens,
      maxOutputTokens: providerConfig.maxTokens ?? null,
      timeoutMs: providerConfig.timeoutMs ?? settings.requestTimeoutMs,
      displayMode: settings.displayMode,
      pipelineVersion: PRECISION_PIPELINE_VERSION,
    })

    const analysisStartedAt = Date.now()
    await log('info', 'pipeline', '开始分析全文上下文', {
      sampledSegmentCount: snapshot.segments.length,
    })
    const context = await analyzeArticle({
      provider,
      model: providerConfig.model,
      snapshot,
      sourceLanguage: 'auto',
      targetLanguage: settings.defaultTargetLanguage,
      terminology: settings.terminology,
      maxTokens: providerConfig.maxTokens,
      signal: controller.signal,
      requestTimeoutMs: providerConfig.timeoutMs ?? settings.requestTimeoutMs,
      maxRetries: 2,
      onProviderTelemetry: recordProviderTelemetry,
      onRepair: () => log('warn', 'pipeline', '全文分析 JSON 格式异常，执行一次修复'),
    })
    await log('info', 'pipeline', '全文上下文分析完成', {
      durationMs: Date.now() - analysisStartedAt,
      terminologyCount: context.terminology.length,
      namedEntityCount: context.namedEntities.length,
    })
    contexts.set(tabId, context)
    const cache = new TranslationCache(settings.cacheCapacity)

    for (const [chunkOffset, chunk] of chunks.entries()) {
      if (!task.pendingChunkIds.includes(chunk.id)) continue
      if (controller.signal.aborted) return
      const persisted = await getTaskForTab(tabId)
      if (persisted?.status === 'paused' || persisted?.status === 'cancelled') return
      const chunkStartedAt = Date.now()
      task = taskStateReducer(task, {
        type: 'BEGIN_CHUNK',
        chunkId: chunk.id,
        index: chunkOffset + 1,
        total: chunks.length,
        segmentCount: chunk.segmentIds.length,
      })
      await saveTask(task)
      await log('info', 'pipeline', '开始处理 Chunk', {
        chunkId: chunk.id,
        segmentCount: chunk.segmentIds.length,
        estimatedTokens: chunk.estimatedTokens,
        continuitySegments: task.translationMemory?.length ?? 0,
      })
      try {
        const translated = await translateChunk(chunk, snapshot.segments, {
          provider,
          providerType: providerConfig.type,
          model: providerConfig.model,
          articleContext: context,
          sourceLanguage: 'auto',
          targetLanguage: settings.defaultTargetLanguage,
          translationMode: 'precision',
          terminology: settings.terminology,
          customInstruction: settings.customInstruction,
          maxTokens: providerConfig.maxTokens,
          maxContextTokens: Math.min(900, Math.max(400, Math.floor(settings.maxChunkTokens * 0.6))),
          previousFinalTranslations: task.translationMemory,
          cache,
          signal: controller.signal,
          requestTimeoutMs: providerConfig.timeoutMs ?? settings.requestTimeoutMs,
          maxRetries: 2,
          onProviderTelemetry: recordProviderTelemetry,
          onProgress: async (progress) => {
            const stageName =
              progress.stage === 'translating'
                ? '初始翻译'
                : progress.stage === 'reviewing'
                  ? '翻译审阅'
                  : '最终润色'
            if (progress.event === 'cache') {
              await log('info', 'pipeline', 'Chunk 缓存检查完成', {
                chunkId: progress.chunkId,
                cacheHits: progress.cacheHitCount ?? 0,
                cacheMisses: progress.cacheMissCount ?? 0,
                segmentCount: progress.segmentCount ?? 0,
              })
              return
            }
            if (progress.event === 'started') {
              task = taskStateReducer(task!, {
                type: 'SET_STAGE',
                status: progress.stage,
                stage: stageName,
                section: progress.currentSection,
              })
              await saveTask(task)
            }
            const watchdogKey = `${progress.chunkId}:${progress.stage}`
            const existingWatchdog = stageWatchdogs.get(watchdogKey)
            if (progress.event === 'started') {
              if (existingWatchdog) clearTimeout(existingWatchdog)
              const stageStartedAt = Date.now()
              const scheduleWatchdog = () => {
                const watchdog = globalThis.setTimeout(() => {
                  if (!stageWatchdogs.has(watchdogKey)) return
                  const elapsedMs = Date.now() - stageStartedAt
                  const activeRequest = task?.telemetry?.activeRequest
                  void writeDiagnosticLog({
                    level: 'warn',
                    scope: 'provider',
                    message: `${stageName}仍在等待模型响应`,
                    tabId,
                    taskId: task?.taskId,
                    requestId: activeRequest?.requestId,
                    chunkId: progress.chunkId,
                    operation: activeRequest?.operation,
                    details: {
                      segmentCount: progress.segmentCount ?? 0,
                      model: providerConfig.model,
                      elapsedMs,
                      attempt: activeRequest?.attempt ?? null,
                      requestState: activeRequest?.state ?? null,
                    },
                  })
                  scheduleWatchdog()
                }, 15_000)
                stageWatchdogs.set(watchdogKey, watchdog)
              }
              scheduleWatchdog()
            } else if (progress.event === 'completed') {
              if (existingWatchdog) clearTimeout(existingWatchdog)
              stageWatchdogs.delete(watchdogKey)
            }
            await log(
              progress.event === 'repairing' ? 'warn' : 'info',
              'pipeline',
              progress.event === 'started'
                ? `${stageName}请求已发送`
                : progress.event === 'completed'
                  ? `${stageName}响应完成`
                  : `${stageName}响应格式异常，执行一次 JSON 修复`,
              {
                chunkId: progress.chunkId,
                segmentCount: progress.segmentCount ?? 0,
                durationMs: progress.durationMs ?? null,
                model: providerConfig.model,
              },
            )
          },
        })
        task = {
          ...task,
          translationMemory: updateTranslationMemory(task.translationMemory, translated),
          translations: mergeSegmentTranslations(task.translations, translated),
          updatedAt: Date.now(),
        }
        await saveTask(task)
        const renderResponse = await renderTranslationsToPage({
          tabId,
          translations: translated,
          segments: snapshot.segments,
          showToolbar: settings.showSegmentToolbar,
          mode: settings.displayMode,
          opacity: settings.originalOpacity,
          translationStyle: settings.translationDisplayStyle,
          translationLineHeight: settings.translationLineHeight,
          translationFont: settings.translationFont,
        })
        const renderedCount = renderResponse.attachedCount ?? renderResponse.renderedCount ?? 0
        const visibleCount = renderResponse.visibleCount ?? renderedCount
        const renderFailureCount = renderResponse.failedSegmentIds?.length ?? 0
        const hiddenCount = renderResponse.hiddenSegmentIds?.length ?? 0
        if (translated.length > 0 && renderedCount === 0) {
          throw new Error(`译文已生成，但页面回写失败：${renderResponse.error ?? '找不到对应段落节点'}`)
        }
        if (settings.displayMode !== 'original' && translated.length > 0 && visibleCount === 0) {
          throw new Error(`译文已插入，但在页面上不可见：${renderResponse.error ?? '可能被页面样式隐藏'}`)
        }
        if (renderFailureCount > 0 || hiddenCount > 0) {
          await log('warn', 'render', '部分译文未正常显示在页面', {
            chunkId: chunk.id,
            translatedCount: translated.length,
            renderedCount,
            visibleCount,
            renderFailureCount,
            hiddenCount,
          })
        }
        task = taskStateReducer(task, {
          type: 'CHUNK_COMPLETED',
          chunkId: chunk.id,
          segmentCount: chunk.segmentIds.length,
          durationMs: Date.now() - chunkStartedAt,
        })
        await log('info', 'render', 'Chunk 已完成并回写页面', {
          chunkId: chunk.id,
          translatedCount: translated.length,
          renderedCount,
          visibleCount,
          durationMs: Date.now() - chunkStartedAt,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        for (const [key, watchdog] of stageWatchdogs) {
          if (key.startsWith(`${chunk.id}:`)) {
            clearTimeout(watchdog)
            stageWatchdogs.delete(key)
          }
        }
        await log('error', 'pipeline', 'Chunk 处理失败，继续后续 Chunk', {
          chunkId: chunk.id,
          segmentCount: chunk.segmentIds.length,
          durationMs: Date.now() - chunkStartedAt,
          ...diagnosticErrorDetails(error),
        })
        task = taskStateReducer(task, {
          type: 'CHUNK_FAILED',
          chunkId: chunk.id,
          segmentCount: chunk.segmentIds.length,
          error: error instanceof Error ? error.message : 'Chunk 翻译失败',
          durationMs: Date.now() - chunkStartedAt,
        })
      }
      await saveTask(task)
    }
    task = taskStateReducer(task, {
      type: 'SET_STATUS',
      status: task.failedChunkIds.length === chunks.length ? 'failed' : 'completed',
      error: task.failedChunkIds.length > 0 ? '部分段落翻译失败，可重新精译' : undefined,
    })
    await saveTask(task)
    await log(task.status === 'completed' ? 'info' : 'error', 'task', '翻译任务结束', {
      status: task.status,
      completedSegments: task.completedSegments,
      failedSegments: task.failedSegments,
      completedChunks: task.completedChunkIds.length,
      failedChunks: task.failedChunkIds.length,
      totalRequests: task.telemetry?.totalRequests ?? 0,
      requestFailures: task.telemetry?.failedRequests ?? 0,
      retries: task.telemetry?.retryCount ?? 0,
      averageLatencyMs: task.telemetry?.completedRequests
        ? Math.round(task.telemetry.totalLatencyMs / (task.telemetry.completedRequests + task.telemetry.failedRequests))
        : null,
      totalTokens: task.telemetry?.totalTokens ?? 0,
    })
  } catch (error) {
    if (controller.signal.aborted) return
    await log('error', 'task', '翻译任务失败', diagnosticErrorDetails(error))
    const fallback = task ?? {
      taskId: crypto.randomUUID(), tabId, pageUrl: '', articleSelector: '',
      status: 'failed' as const, totalSegments: 0, completedSegments: 0, failedSegments: 0,
      pendingChunkIds: [], completedChunkIds: [], failedChunkIds: [], providerId: '',
      targetLanguage: 'zh-CN', displayMode: 'bilingual' as const, originalOpacity: 0.32,
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    task = taskStateReducer(fallback, {
      type: 'SET_STATUS',
      status: 'failed',
      error: error instanceof Error ? error.message : '翻译任务失败',
    })
    await saveTask(task)
  } finally {
    stageWatchdogs.forEach((watchdog) => clearTimeout(watchdog))
    stageWatchdogs.clear()
    await taskWriteQueue.catch(() => undefined)
    if (controllers.get(tabId) === controller) controllers.delete(tabId)
  }
}

async function setTaskStatus(taskId: string, status: 'paused' | 'cancelled'): Promise<TranslationTaskState> {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id) continue
    const task = await getTaskForTab(tab.id)
    if (task?.taskId !== taskId) continue
    controllers.get(tab.id)?.abort()
    controllers.delete(tab.id)
    const next = taskStateReducer(task, { type: 'SET_STATUS', status })
    await notifyTask(next)
    await writeDiagnosticLog({
      level: 'info',
      scope: 'lifecycle',
      message: status === 'paused' ? '用户暂停翻译任务' : '用户停止翻译任务',
      tabId: tab.id,
      taskId,
      details: { status },
    })
    return next
  }
  throw new Error('找不到翻译任务')
}

async function retranslateSegment(
  tabId: number,
  segmentId: string,
  instruction?: string,
): Promise<void> {
  const [snapshot, settings, storedTask] = await Promise.all([
    getSnapshot(tabId), getSettings(), getTaskForTab(tabId),
  ])
  const segment = snapshot.segments.find((item) => item.id === segmentId)
  if (!segment) throw new Error('原段落已被页面移除')
  const config = await resolveProvider(storedTask?.providerId)
  const provider = createProvider(config)
  let task = storedTask
  let telemetryQueue: Promise<void> = Promise.resolve()
  const chunkId = `single-${segmentId}`
  const recordProviderTelemetry = (event: ProviderRequestTelemetryEvent) => {
    if (task) {
      task = taskStateReducer(task, { type: 'PROVIDER_TELEMETRY', event })
      const snapshot = structuredClone(task)
      telemetryQueue = telemetryQueue.catch(() => undefined).then(() => notifyTask(snapshot))
    }
    const level = event.type === 'request-failed'
      ? 'error'
      : event.type === 'retry-scheduled' || (event.type === 'request-completed' && event.elapsedMs >= 15_000)
        ? 'warn'
        : 'info'
    void writeDiagnosticLog({
      level,
      scope: 'provider',
      message: event.type === 'retry-scheduled'
        ? '单段重译模型请求等待重试'
        : event.type === 'request-failed'
          ? '单段重译模型请求失败'
          : event.type === 'request-completed'
            ? '单段重译模型请求完成'
            : '单段重译模型请求进度更新',
      tabId,
      taskId: task?.taskId,
      requestId: event.requestId,
      chunkId,
      operation: event.operation,
      details: {
        attempt: event.attempt ?? null,
        maxAttempts: event.maxAttempts,
        timeoutMs: event.timeoutMs,
        elapsedMs: event.elapsedMs,
        httpStatus: event.status ?? null,
        retryDelayMs: event.retryDelayMs ?? null,
        errorCode: event.errorCode ?? null,
      },
    })
  }
  const context = contexts.get(tabId) ?? await analyzeArticle({
    provider, model: config.model, snapshot, sourceLanguage: 'auto',
    targetLanguage: settings.defaultTargetLanguage, terminology: settings.terminology,
    maxTokens: config.maxTokens,
    requestTimeoutMs: config.timeoutMs ?? settings.requestTimeoutMs,
    maxRetries: 2,
    onProviderTelemetry: recordProviderTelemetry,
  })
  contexts.set(tabId, context)
  const [translation] = await translateChunk(
    {
      id: chunkId, segmentIds: [segmentId],
      headingContext: segment.headingContext ?? [], estimatedTokens: 0,
    },
    snapshot.segments,
    {
      provider, providerType: config.type, model: config.model, articleContext: context,
      sourceLanguage: 'auto', targetLanguage: settings.defaultTargetLanguage,
      translationMode: 'precision', terminology: settings.terminology,
      customInstruction: instruction || settings.customInstruction,
      maxTokens: config.maxTokens,
      maxContextTokens: Math.min(900, Math.max(400, Math.floor(settings.maxChunkTokens * 0.6))),
      previousFinalTranslations: task?.translationMemory,
      cache: new TranslationCache(settings.cacheCapacity), bypassCache: true,
      requestTimeoutMs: config.timeoutMs ?? settings.requestTimeoutMs,
      maxRetries: 2,
      onProviderTelemetry: recordProviderTelemetry,
    },
  )
  const renderResponse = await renderTranslationsToPage({
    tabId,
    translations: [translation],
    segments: [segment],
    showToolbar: settings.showSegmentToolbar,
    mode: settings.displayMode,
    opacity: settings.originalOpacity,
    translationStyle: settings.translationDisplayStyle,
    translationLineHeight: settings.translationLineHeight,
    translationFont: settings.translationFont,
  })
  const attachedCount = renderResponse.attachedCount ?? renderResponse.renderedCount ?? 0
  if (attachedCount === 0) {
    throw new Error(`单段译文已生成，但页面回写失败：${renderResponse.error ?? '找不到对应段落节点'}`)
  }
  if (settings.displayMode !== 'original' && (renderResponse.visibleCount ?? attachedCount) === 0) {
    throw new Error(`单段译文已插入，但在页面上不可见：${renderResponse.error ?? '可能被页面样式隐藏'}`)
  }
  await telemetryQueue.catch(() => undefined)
  if (task) {
    const next = {
      ...task,
      translationMemory: updateTranslationMemory(task.translationMemory, [translation]),
      translations: mergeSegmentTranslations(task.translations, [translation]),
      updatedAt: Date.now(),
    }
    await notifyTask(next)
  }
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const parsed = messageSchema.safeParse(raw)
  if (!parsed.success) return false
  const message = parsed.data
  void (async () => {
    switch (message.type) {
      case 'GET_DIAGNOSTIC_LOGS':
        sendResponse({ ok: true, logs: await getDiagnosticLogs(message.tabId) })
        break
      case 'CLEAR_DIAGNOSTIC_LOGS':
        await clearDiagnosticLogs(message.tabId)
        sendResponse({ ok: true })
        break
      case 'GET_CONTENT_CONFIG': {
        const [siteRules, settings] = await Promise.all([getSiteRules(), getSettings()])
        sendResponse({
          ok: true,
          siteRules,
          autoUseSiteRules: settings.autoUseSiteRules,
        })
        break
      }
      case 'GET_TASK': {
        let task = await getTaskForTab(message.tabId)
        if (task && !task.model) {
          try {
            const providerConfig = await resolveProvider(task.providerId)
            task = {
              ...task,
              providerName: providerConfig.name,
              providerType: providerConfig.type,
              model: providerConfig.model,
            }
            await notifyTask(task)
          } catch {
            // Preserve the task even if its old Provider configuration was deleted.
          }
        }
        if (task?.translations?.length) {
          try {
            const [tab, settings, currentSnapshot] = await Promise.all([
              chrome.tabs.get(message.tabId),
              getSettings(),
              getSnapshot(message.tabId),
            ])
            if (tab.url === task.pageUrl && currentSnapshot.url === task.pageUrl) {
              const renderResponse = await renderTranslationsToPage({
                tabId: message.tabId,
                translations: task.translations,
                segments: currentSnapshot.segments,
                showToolbar: settings.showSegmentToolbar,
                mode: settings.displayMode,
                opacity: settings.originalOpacity,
                translationStyle: settings.translationDisplayStyle,
                translationLineHeight: settings.translationLineHeight,
                translationFont: settings.translationFont,
              })
              await writeDiagnosticLog({
                level: renderResponse.failedSegmentIds?.length || renderResponse.hiddenSegmentIds?.length ? 'warn' : 'info',
                scope: 'render',
                message: renderResponse.failedSegmentIds?.length || renderResponse.hiddenSegmentIds?.length
                  ? '恢复任务时仅回写了部分持久化译文'
                  : '已恢复持久化译文到当前页面',
                tabId: message.tabId,
                taskId: task.taskId,
                details: {
                  translatedCount: task.translations.length,
                  renderedCount: renderResponse.attachedCount ?? renderResponse.renderedCount ?? 0,
                  visibleCount: renderResponse.visibleCount ?? 0,
                  renderFailureCount: renderResponse.failedSegmentIds?.length ?? 0,
                  hiddenCount: renderResponse.hiddenSegmentIds?.length ?? 0,
                },
              })
            }
          } catch (error) {
            await writeDiagnosticLog({
              level: 'warn',
              scope: 'render',
              message: '恢复持久化译文到页面失败',
              tabId: message.tabId,
              taskId: task.taskId,
              details: diagnosticErrorDetails(error),
            })
          }
        }
        if (
          task &&
          ['analyzing', 'translating', 'reviewing', 'refining'].includes(task.status) &&
          !controllers.has(message.tabId)
        ) {
          void runTask(message.tabId, task)
        }
        sendResponse({ ok: true, task })
        break
      }
      case 'GET_EXPORT_TASK': {
        let exportTask = await getExportTask(message.tabId)
        if (
          exportTask &&
          !['completed', 'failed', 'cancelled'].includes(exportTask.status) &&
          !exportControllers.has(message.tabId)
        ) {
          exportTask = {
            ...exportTask,
            status: 'failed',
            stage: '导出中断',
            errorCode: 'UNKNOWN',
            error: '扩展后台已重启，请重新导出',
            updatedAt: Date.now(),
          }
          await notifyExportTask(exportTask)
        }
        sendResponse({ ok: true, task: exportTask })
        break
      }
      case 'START_EXPORT': {
        const options = articleExportOptionsSchema.parse(message.options)
        const article = exportArticleSchema.parse(message.article)
        const translationTask = await getTaskForTab(message.tabId)
        const exportTask = createExportTask(message.tabId, options.filename, article.metadata.sourceUrl)
        await notifyExportTask(exportTask)
        runExportTask(exportTask, article, options, translationTask?.translations)
        sendResponse({ ok: true, task: exportTask })
        break
      }
      case 'CANCEL_EXPORT': {
        const runningExport = [...exportControllers.entries()]
          .find(([, value]) => value.taskId === message.taskId)
        if (!runningExport) throw new Error('找不到正在运行的导出任务')
        const [tabId, value] = runningExport
        value.controller.abort()
        const current = await getExportTask(tabId)
        if (current) {
          await notifyExportTask({
            ...current,
            status: 'cancelled',
            stage: '导出已取消',
            errorCode: 'EXPORT_CANCELLED',
            error: undefined,
            updatedAt: Date.now(),
          })
        }
        sendResponse({ ok: true })
        break
      }
      case 'CLEAR_TASK': {
        controllers.get(message.tabId)?.abort()
        controllers.delete(message.tabId)
        contexts.delete(message.tabId)
        await removeTaskForTab(message.tabId)
        sendResponse({ ok: true })
        break
      }
      case 'START_TRANSLATION': {
        const tabId = message.tabId ?? sender.tab?.id
        if (!tabId) throw new Error('找不到当前标签页')
        const currentSnapshot = await getSnapshot(tabId)
        if (requiresArticleRegionConfirmation(currentSnapshot) && !message.allowPartialRegion) {
          const coverage = currentSnapshot.regionCoverage!
          await writeDiagnosticLog({
            level: 'warn',
            scope: 'task',
            message: '已阻止未确认的局部区域翻译',
            tabId,
            details: {
              selector: currentSnapshot.region.selector,
              segmentCount: currentSnapshot.segments.length,
              coveragePercent: Math.round(coverage.ratio * 100),
              automaticSelector: coverage.automaticSelector,
              automaticParagraphCount: coverage.automaticParagraphCount,
            },
          })
          sendResponse({
            ok: false,
            error: `当前区域仅覆盖自动正文的 ${Math.round(coverage.ratio * 100)}%，请先恢复全文或确认翻译当前区域`,
          })
          break
        }
        void runTask(tabId)
        sendResponse({ ok: true })
        break
      }
      case 'PAUSE_TRANSLATION':
        sendResponse({ ok: true, task: await setTaskStatus(message.taskId, 'paused') })
        break
      case 'RESUME_TRANSLATION': {
        const tabs = await chrome.tabs.query({})
        const task = (await Promise.all(tabs.filter((tab) => tab.id).map((tab) => getTaskForTab(tab.id!))))
          .find((item) => item?.taskId === message.taskId)
        if (!task) throw new Error('找不到翻译任务')
        void runTask(task.tabId, task)
        sendResponse({ ok: true })
        break
      }
      case 'STOP_TRANSLATION':
        sendResponse({ ok: true, task: await setTaskStatus(message.taskId, 'cancelled') })
        break
      case 'RETRANSLATE_SEGMENT': {
        const tabId = sender.tab?.id
        if (!tabId) throw new Error('找不到段落所在标签页')
        await retranslateSegment(tabId, message.segmentId, message.instruction)
        sendResponse({ ok: true })
        break
      }
      case 'TEST_PROVIDER': {
        const config = await resolveProvider(message.providerId)
        const startedAt = Date.now()
        await writeDiagnosticLog({
          level: 'info', scope: 'provider', message: '开始测试 Provider 连接',
          details: { providerType: config.type, model: config.model },
        })
        try {
          const result = await createProvider(config).testConnection()
          await writeDiagnosticLog({
            level: 'info', scope: 'provider', message: 'Provider 连接测试成功',
            details: { providerType: config.type, model: config.model, durationMs: Date.now() - startedAt },
          })
          sendResponse({ ok: true, result })
        } catch (error) {
          await writeDiagnosticLog({
            level: 'error', scope: 'provider', message: 'Provider 连接测试失败',
            details: { providerType: config.type, model: config.model, durationMs: Date.now() - startedAt, ...diagnosticErrorDetails(error) },
          })
          throw error
        }
        break
      }
      case 'PAGE_NAVIGATED': {
        const tabId = sender.tab?.id
        if (tabId) {
          controllers.get(tabId)?.abort()
          controllers.delete(tabId)
          contexts.delete(tabId)
          exportControllers.get(tabId)?.controller.abort()
          exportControllers.delete(tabId)
          await removeTaskForTab(tabId)
          await writeDiagnosticLog({
            level: 'info', scope: 'lifecycle', message: '页面导航，已清理关联任务', tabId,
          })
        }
        sendResponse({ ok: true })
        break
      }
      default:
        return
    }
  })().catch((error: unknown) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : '后台处理失败' })
  })
  return true
})

chrome.tabs.onRemoved.addListener((tabId) => {
  controllers.get(tabId)?.abort()
  controllers.delete(tabId)
  contexts.delete(tabId)
  exportControllers.get(tabId)?.controller.abort()
  exportControllers.delete(tabId)
  void removeTaskForTab(tabId)
})

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

export async function saveRule(rule: SiteRule): Promise<void> {
  const rules = await getSiteRules()
  await saveSiteRules([...rules.filter((item) => item.id !== rule.id), rule])
}
