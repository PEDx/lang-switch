import type {
  ProviderRequestTelemetryEvent,
  TranslationTaskState,
  TranslationTaskStatus,
  TranslationTaskTelemetry,
} from '../shared/types'
import { getTasks, saveTasks } from '../shared/storage'

const MAX_PERSISTED_TASKS = 32

export type TaskAction =
  | { type: 'SET_STATUS'; status: TranslationTaskStatus; error?: string }
  | { type: 'SET_STAGE'; status: TranslationTaskStatus; stage: string; section?: string }
  | { type: 'BEGIN_CHUNK'; chunkId: string; index: number; total: number; segmentCount: number }
  | { type: 'CHUNK_COMPLETED'; chunkId: string; segmentCount: number; durationMs?: number }
  | { type: 'CHUNK_FAILED'; chunkId: string; segmentCount: number; error: string; durationMs?: number }
  | { type: 'PROVIDER_TELEMETRY'; event: ProviderRequestTelemetryEvent }
  | { type: 'RESET_PENDING'; chunkIds: string[] }
  | { type: 'SET_DISPLAY'; displayMode: TranslationTaskState['displayMode']; opacity: number }

export function taskStateReducer(
  state: TranslationTaskState,
  action: TaskAction,
): TranslationTaskState {
  const updatedAt = Date.now()
  switch (action.type) {
    case 'SET_STATUS':
      return {
        ...state,
        status: action.status,
        error: action.error,
        telemetry: state.telemetry
          ? {
              ...state.telemetry,
              lastActivityAt: updatedAt,
              activeRequest: ['paused', 'completed', 'failed', 'cancelled'].includes(action.status)
                ? undefined
                : state.telemetry.activeRequest,
            }
          : undefined,
        updatedAt,
      }
    case 'SET_STAGE':
      return {
        ...state,
        status: action.status,
        currentStage: action.stage,
        currentSection: action.section,
        telemetry: state.telemetry ? {
          ...state.telemetry,
          stageStartedAt: state.status === action.status
            ? state.telemetry.stageStartedAt
            : updatedAt,
          lastActivityAt: updatedAt,
        } : undefined,
        chunkProgress: state.chunkProgress?.map((chunk) =>
          chunk.chunkId === state.currentChunkId
            ? { ...chunk, stage: action.status, updatedAt }
            : chunk,
        ),
        updatedAt,
      }
    case 'BEGIN_CHUNK':
      return {
        ...state,
        totalChunks: action.total,
        currentChunkId: action.chunkId,
        currentChunkIndex: action.index,
        chunkProgress: (state.chunkProgress ?? []).map((chunk) =>
          chunk.chunkId === action.chunkId
            ? { ...chunk, status: 'running', startedAt: updatedAt, updatedAt }
            : chunk,
        ),
        telemetry: state.telemetry ? { ...state.telemetry, lastActivityAt: updatedAt } : undefined,
        updatedAt,
      }
    case 'CHUNK_COMPLETED': {
      const completedDuration = action.durationMs ?? 0
      const completedChunks = state.completedChunkIds.includes(action.chunkId)
        ? state.completedChunkIds.length
        : state.completedChunkIds.length + 1
      const durationTotal = (state.telemetry?.completedChunkDurationMs ?? 0) + completedDuration
      const remainingChunks = Math.max(0, (state.totalChunks ?? 0) - completedChunks - state.failedChunkIds.length)
      return {
        ...state,
        completedSegments: Math.min(state.totalSegments, state.completedSegments + action.segmentCount),
        pendingChunkIds: state.pendingChunkIds.filter((id) => id !== action.chunkId),
        completedChunkIds: state.completedChunkIds.includes(action.chunkId)
          ? state.completedChunkIds
          : [...state.completedChunkIds, action.chunkId],
        chunkProgress: state.chunkProgress?.map((chunk) =>
          chunk.chunkId === action.chunkId
            ? { ...chunk, status: 'completed', durationMs: action.durationMs, updatedAt }
            : chunk,
        ),
        telemetry: state.telemetry ? {
          ...state.telemetry,
          completedChunkDurationMs: durationTotal,
          estimatedRemainingMs: completedChunks > 0
            ? Math.round((durationTotal / completedChunks) * remainingChunks)
            : undefined,
          lastActivityAt: updatedAt,
        } : undefined,
        updatedAt,
      }
    }
    case 'CHUNK_FAILED': {
      const failedChunks = state.failedChunkIds.includes(action.chunkId)
        ? state.failedChunkIds.length
        : state.failedChunkIds.length + 1
      const completedChunks = state.completedChunkIds.length
      const remainingChunks = Math.max(0, (state.totalChunks ?? 0) - completedChunks - failedChunks)
      return {
        ...state,
        failedSegments: Math.min(state.totalSegments, state.failedSegments + action.segmentCount),
        pendingChunkIds: state.pendingChunkIds.filter((id) => id !== action.chunkId),
        failedChunkIds: state.failedChunkIds.includes(action.chunkId)
          ? state.failedChunkIds
          : [...state.failedChunkIds, action.chunkId],
        error: action.error,
        chunkProgress: state.chunkProgress?.map((chunk) =>
          chunk.chunkId === action.chunkId
            ? { ...chunk, status: 'failed', durationMs: action.durationMs, error: action.error, updatedAt }
            : chunk,
        ),
        telemetry: state.telemetry ? {
          ...state.telemetry,
          estimatedRemainingMs: completedChunks > 0
            ? Math.round((state.telemetry.completedChunkDurationMs / completedChunks) * remainingChunks)
            : undefined,
          lastActivityAt: updatedAt,
        } : undefined,
        updatedAt,
      }
    }
    case 'PROVIDER_TELEMETRY': {
      const event = action.event
      const telemetry: TranslationTaskTelemetry = state.telemetry ?? {
        startedAt: state.createdAt,
        stageStartedAt: state.createdAt,
        lastActivityAt: state.createdAt,
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
      }
      if (event.type === 'request-started') {
        return {
          ...state,
          telemetry: {
            ...telemetry,
            totalRequests: telemetry.totalRequests + 1,
            lastActivityAt: event.timestamp,
            activeRequest: {
              requestId: event.requestId,
              operation: event.operation,
              state: 'requesting',
              attempt: 1,
              maxAttempts: event.maxAttempts,
              startedAt: event.timestamp,
              timeoutMs: event.timeoutMs,
            },
          },
          updatedAt,
        }
      }
      if (event.type === 'attempt-started') {
        return {
          ...state,
          telemetry: {
            ...telemetry,
            lastActivityAt: event.timestamp,
            activeRequest: {
              requestId: event.requestId,
              operation: event.operation,
              state: 'requesting',
              attempt: event.attempt ?? 1,
              maxAttempts: event.maxAttempts,
              startedAt: telemetry.activeRequest?.requestId === event.requestId
                ? telemetry.activeRequest.startedAt
                : event.timestamp,
              attemptStartedAt: event.timestamp,
              timeoutMs: event.timeoutMs,
            },
          },
          updatedAt,
        }
      }
      if (event.type === 'response-received') {
        return {
          ...state,
          telemetry: {
            ...telemetry,
            lastActivityAt: event.timestamp,
            lastHttpStatus: event.status,
            activeRequest: telemetry.activeRequest?.requestId === event.requestId
              ? { ...telemetry.activeRequest, state: 'processing', lastHttpStatus: event.status }
              : telemetry.activeRequest,
          },
          updatedAt,
        }
      }
      if (event.type === 'retry-scheduled') {
        return {
          ...state,
          telemetry: {
            ...telemetry,
            retryCount: telemetry.retryCount + 1,
            lastActivityAt: event.timestamp,
            lastHttpStatus: event.status ?? telemetry.lastHttpStatus,
            lastErrorCode: event.errorCode,
            activeRequest: {
              requestId: event.requestId,
              operation: event.operation,
              state: 'backoff',
              attempt: event.attempt ?? 1,
              maxAttempts: event.maxAttempts,
              startedAt: telemetry.activeRequest?.requestId === event.requestId
                ? telemetry.activeRequest.startedAt
                : event.timestamp - event.elapsedMs,
              timeoutMs: event.timeoutMs,
              retryAt: event.timestamp + (event.retryDelayMs ?? 0),
              lastHttpStatus: event.status,
            },
          },
          updatedAt,
        }
      }
      const succeeded = event.type === 'request-completed'
      return {
        ...state,
        telemetry: {
          ...telemetry,
          completedRequests: telemetry.completedRequests + (succeeded ? 1 : 0),
          failedRequests: telemetry.failedRequests + (succeeded ? 0 : 1),
          slowRequestCount: telemetry.slowRequestCount + (event.elapsedMs >= 15_000 ? 1 : 0),
          totalLatencyMs: telemetry.totalLatencyMs + event.elapsedMs,
          lastLatencyMs: event.elapsedMs,
          lastHttpStatus: event.status ?? telemetry.lastHttpStatus,
          lastErrorCode: event.errorCode,
          inputTokens: telemetry.inputTokens + (event.inputTokens ?? 0),
          outputTokens: telemetry.outputTokens + (event.outputTokens ?? 0),
          totalTokens: telemetry.totalTokens + (event.totalTokens ?? 0),
          lastActivityAt: event.timestamp,
          activeRequest: telemetry.activeRequest?.requestId === event.requestId
            ? undefined
            : telemetry.activeRequest,
        },
        updatedAt,
      }
    }
    case 'RESET_PENDING':
      return { ...state, pendingChunkIds: action.chunkIds, updatedAt }
    case 'SET_DISPLAY':
      return {
        ...state,
        displayMode: action.displayMode,
        originalOpacity: action.opacity,
        updatedAt,
      }
  }
}

export async function getTaskForTab(tabId: number): Promise<TranslationTaskState | null> {
  const tasks = await getTasks()
  return tasks[String(tabId)] ?? null
}

export async function persistTask(task: TranslationTaskState): Promise<void> {
  const tasks = await getTasks()
  tasks[String(task.tabId)] = task
  const recent = Object.entries(tasks)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_PERSISTED_TASKS)
  await saveTasks(Object.fromEntries(recent))
}

export async function removeTaskForTab(tabId: number): Promise<void> {
  const tasks = await getTasks()
  delete tasks[String(tabId)]
  await saveTasks(tasks)
}
