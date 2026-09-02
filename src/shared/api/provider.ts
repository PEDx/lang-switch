import type {
  LLMRequestOptions,
  LLMResponse,
  ProviderRequestTelemetryEvent,
} from '../types'

export type ProviderErrorCode =
  | 'authentication'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid_response'
  | 'configuration'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(
    message: string,
    code: ProviderErrorCode,
    status?: number,
    retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

function retryDelay(attempt: number, retryAfterMs?: number): number {
  return retryAfterMs ?? Math.min(8_000, 500 * 2 ** attempt + Math.random() * 250)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

export interface PreparedRequestTelemetry {
  options: LLMRequestOptions
  requestId: string
  operation: string
  startedAt: number
  timeoutMs: number
  maxAttempts: number
}

export function prepareRequestTelemetry(
  options: LLMRequestOptions | undefined,
  defaultTimeoutMs = 60_000,
): PreparedRequestTelemetry {
  const normalized = {
    ...options,
    requestId: options?.requestId ?? crypto.randomUUID(),
    operation: options?.operation ?? 'llm-completion',
    timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
    maxRetries: options?.maxRetries ?? 2,
  }
  return {
    options: normalized,
    requestId: normalized.requestId,
    operation: normalized.operation,
    startedAt: Date.now(),
    timeoutMs: normalized.timeoutMs,
    maxAttempts: normalized.maxRetries + 1,
  }
}

export function emitProviderTelemetry(
  telemetry: PreparedRequestTelemetry,
  input: Omit<ProviderRequestTelemetryEvent, 'requestId' | 'operation' | 'timestamp' | 'maxAttempts' | 'timeoutMs' | 'elapsedMs'>
    & { elapsedMs?: number },
): void {
  try {
    telemetry.options.onTelemetry?.({
      ...input,
      requestId: telemetry.requestId,
      operation: telemetry.operation,
      timestamp: Date.now(),
      maxAttempts: telemetry.maxAttempts,
      timeoutMs: telemetry.timeoutMs,
      elapsedMs: input.elapsedMs ?? Date.now() - telemetry.startedAt,
    })
  } catch {
    // Telemetry must never interrupt a model request.
  }
}

function sanitizeServerMessage(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const raw = await response.text()
    if (!raw) return ''
    const parsed = JSON.parse(raw) as {
      message?: unknown
      error_msg?: unknown
      error?: { message?: unknown } | string
    }
    const detail =
      parsed.error && typeof parsed.error === 'object'
        ? parsed.error.message
        : parsed.error ?? parsed.message ?? parsed.error_msg
    return typeof detail === 'string' ? sanitizeServerMessage(detail) : ''
  } catch {
    return ''
  }
}

function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('请求已取消', 'network'))
      return
    }
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      reject(new ProviderError('请求已取消', 'network'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: LLMRequestOptions = {},
  maxRetries = 2,
): Promise<Response> {
  const telemetry = prepareRequestTelemetry(options)
  const retries = options.maxRetries ?? maxRetries
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw new ProviderError('请求已取消', 'network')
    const attemptNumber = attempt + 1
    const attemptStartedAt = Date.now()
    emitProviderTelemetry(telemetry, { type: 'attempt-started', attempt: attemptNumber })
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      emitProviderTelemetry(telemetry, {
        type: 'response-received',
        attempt: attemptNumber,
        status: response.status,
        attemptElapsedMs: Date.now() - attemptStartedAt,
      })
      if (response.ok) return response
      const errorDetail = await readErrorDetail(response)
      const detailSuffix = errorDetail ? `：${errorDetail}` : ''
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(`API 身份验证失败，请检查 API Key${detailSuffix}`, 'authentication', response.status)
      }
      if (response.status === 429) {
        if (attempt < retries) {
          const delayMs = retryDelay(attempt, retryAfterMs)
          emitProviderTelemetry(telemetry, {
            type: 'retry-scheduled', attempt: attemptNumber, status: 429, retryDelayMs: delayMs,
            errorCode: 'rate_limit', attemptElapsedMs: Date.now() - attemptStartedAt,
          })
          await waitForRetry(delayMs, options.signal)
          continue
        }
        throw new ProviderError(`API 请求过于频繁${detailSuffix}`, 'rate_limit', 429, retryAfterMs)
      }
      if (response.status >= 500 && attempt < retries) {
        const delayMs = retryDelay(attempt)
        emitProviderTelemetry(telemetry, {
          type: 'retry-scheduled', attempt: attemptNumber, status: response.status,
          retryDelayMs: delayMs, errorCode: 'server', attemptElapsedMs: Date.now() - attemptStartedAt,
        })
        await waitForRetry(delayMs, options.signal)
        continue
      }
      throw new ProviderError(
        response.status >= 500
          ? `模型服务暂时不可用${detailSuffix}`
          : `模型服务请求失败 (${response.status})${detailSuffix}`,
        response.status >= 500 ? 'server' : 'configuration',
        response.status,
      )
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (options.signal?.aborted) throw new ProviderError('请求已取消', 'network')
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (attempt < retries) {
          const delayMs = retryDelay(attempt)
          emitProviderTelemetry(telemetry, {
            type: 'retry-scheduled', attempt: attemptNumber, retryDelayMs: delayMs,
            errorCode: 'timeout', attemptElapsedMs: Date.now() - attemptStartedAt,
          })
          await waitForRetry(delayMs, options.signal)
          continue
        }
        throw new ProviderError('模型请求超时', 'timeout')
      }
      if (attempt < retries) {
        const delayMs = retryDelay(attempt)
        emitProviderTelemetry(telemetry, {
          type: 'retry-scheduled', attempt: attemptNumber, retryDelayMs: delayMs,
          errorCode: 'network', attemptElapsedMs: Date.now() - attemptStartedAt,
        })
        await waitForRetry(delayMs, options.signal)
        continue
      }
      throw new ProviderError('无法连接模型服务', 'network')
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
    }
  }
  throw new ProviderError('模型请求失败', 'network')
}

export async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ProviderError('模型服务返回了无效 JSON', 'invalid_response', response.status)
  }
}

export function makeTestResult(startedAt: number, response?: LLMResponse) {
  return {
    ok: Boolean(response?.text),
    message: response?.text ? '连接成功' : '连接失败：没有收到文本响应',
    latencyMs: Math.round(performance.now() - startedAt),
  }
}
