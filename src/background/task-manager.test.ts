import type { TranslationTaskState } from '../shared/types'
import { taskStateReducer } from './task-manager'

const task: TranslationTaskState = {
  taskId: 'task-1', tabId: 1, pageUrl: 'https://example.com', articleSelector: 'article',
  status: 'translating', totalSegments: 4, completedSegments: 0, failedSegments: 0,
  pendingChunkIds: ['chunk-1', 'chunk-2'], completedChunkIds: [], failedChunkIds: [],
  providerId: 'provider-1', targetLanguage: 'zh-CN', displayMode: 'bilingual', originalOpacity: .32,
  createdAt: 1, updatedAt: 1,
}

const observableTask: TranslationTaskState = {
  ...task,
  totalChunks: 2,
  chunkProgress: [
    { chunkId: 'chunk-1', index: 1, segmentCount: 2, status: 'pending' },
    { chunkId: 'chunk-2', index: 2, segmentCount: 2, status: 'pending' },
  ],
  telemetry: {
    startedAt: 1,
    stageStartedAt: 1,
    lastActivityAt: 1,
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

describe('task state reducer', () => {
  it('persists completed and failed chunks independently', () => {
    const completed = taskStateReducer(task, { type: 'CHUNK_COMPLETED', chunkId: 'chunk-1', segmentCount: 2 })
    const failed = taskStateReducer(completed, { type: 'CHUNK_FAILED', chunkId: 'chunk-2', segmentCount: 2, error: 'bad JSON' })
    expect(failed.completedSegments).toBe(2)
    expect(failed.failedSegments).toBe(2)
    expect(failed.completedChunkIds).toEqual(['chunk-1'])
    expect(failed.failedChunkIds).toEqual(['chunk-2'])
    expect(failed.pendingChunkIds).toEqual([])
  })

  it('supports pause and display state updates', () => {
    const paused = taskStateReducer(task, { type: 'SET_STATUS', status: 'paused' })
    const display = taskStateReducer(paused, { type: 'SET_DISPLAY', displayMode: 'translation', opacity: .5 })
    expect(display.status).toBe('paused')
    expect(display.displayMode).toBe('translation')
    expect(display.originalOpacity).toBe(.5)
  })

  it('tracks the active request, retry, latency, and token usage', () => {
    const begun = taskStateReducer(observableTask, {
      type: 'BEGIN_CHUNK', chunkId: 'chunk-1', index: 1, total: 2, segmentCount: 2,
    })
    const started = taskStateReducer(begun, {
      type: 'PROVIDER_TELEMETRY',
      event: {
        type: 'request-started', requestId: 'request-1', operation: 'initial-translation',
        timestamp: 100, maxAttempts: 3, timeoutMs: 60_000, elapsedMs: 0,
      },
    })
    const retrying = taskStateReducer(started, {
      type: 'PROVIDER_TELEMETRY',
      event: {
        type: 'retry-scheduled', requestId: 'request-1', operation: 'initial-translation',
        timestamp: 2_100, attempt: 1, maxAttempts: 3, timeoutMs: 60_000,
        elapsedMs: 2_000, retryDelayMs: 500, status: 429, errorCode: 'rate_limit',
      },
    })
    const completed = taskStateReducer(retrying, {
      type: 'PROVIDER_TELEMETRY',
      event: {
        type: 'request-completed', requestId: 'request-1', operation: 'initial-translation',
        timestamp: 3_100, maxAttempts: 3, timeoutMs: 60_000, elapsedMs: 3_000,
        inputTokens: 20, outputTokens: 10, totalTokens: 30,
      },
    })

    expect(started.chunkProgress?.[0].status).toBe('running')
    expect(retrying.telemetry?.activeRequest).toMatchObject({ state: 'backoff', retryAt: 2_600 })
    expect(completed.telemetry).toMatchObject({
      totalRequests: 1,
      completedRequests: 1,
      retryCount: 1,
      totalLatencyMs: 3_000,
      totalTokens: 30,
      activeRequest: undefined,
    })
  })

  it('estimates remaining time from completed chunk duration', () => {
    const begun = taskStateReducer(observableTask, {
      type: 'BEGIN_CHUNK', chunkId: 'chunk-1', index: 1, total: 2, segmentCount: 2,
    })
    const completed = taskStateReducer(begun, {
      type: 'CHUNK_COMPLETED', chunkId: 'chunk-1', segmentCount: 2, durationMs: 12_000,
    })

    expect(completed.telemetry?.estimatedRemainingMs).toBe(12_000)
    expect(completed.chunkProgress?.[0]).toMatchObject({ status: 'completed', durationMs: 12_000 })
  })
})
