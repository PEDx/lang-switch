import { STORAGE_KEYS, storageGet, storageSet } from '../shared/storage'
import type { DiagnosticLogEntry } from '../shared/types'

const MAX_LOG_ENTRIES = 1_000
let writeQueue: Promise<void> = Promise.resolve()

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(/([?&](?:api_?key|token|access_?token)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 800)
}

function sanitizeDetails(
  details?: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> | undefined {
  if (!details) return undefined
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !/(api.?key|authorization|token|secret|prompt|sourceText)/i.test(key))
      .map(([key, value]) => [key, typeof value === 'string' ? redactDiagnosticText(value) : value]),
  )
}

export async function getDiagnosticLogs(tabId?: number): Promise<DiagnosticLogEntry[]> {
  const logs = await storageGet<DiagnosticLogEntry[]>(STORAGE_KEYS.diagnostics, [])
  return tabId === undefined ? logs : logs.filter((entry) => entry.tabId === tabId)
}

export async function clearDiagnosticLogs(tabId?: number): Promise<void> {
  if (tabId === undefined) {
    await storageSet(STORAGE_KEYS.diagnostics, [])
    return
  }
  const logs = await getDiagnosticLogs()
  await storageSet(
    STORAGE_KEYS.diagnostics,
    logs.filter((entry) => entry.tabId !== tabId),
  )
}

export function writeDiagnosticLog(
  input: Omit<DiagnosticLogEntry, 'id' | 'timestamp'>,
): Promise<void> {
  const entry: DiagnosticLogEntry = {
    ...input,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    message: redactDiagnosticText(input.message),
    details: sanitizeDetails(input.details),
  }
  const consoleMethod = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.info
  consoleMethod(`[AI Reader][${entry.scope}] ${entry.message}`, entry.details ?? '')
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    try {
      const logs = await getDiagnosticLogs()
      await storageSet(
        STORAGE_KEYS.diagnostics,
        [...logs, entry].slice(-MAX_LOG_ENTRIES),
      )
      await chrome.runtime.sendMessage({ type: 'DIAGNOSTIC_LOG_UPDATED', entry })
    } catch {
      // Diagnostics must never interrupt translation work.
    }
  })
  return writeQueue
}

export function diagnosticErrorDetails(
  error: unknown,
): Record<string, string | number | boolean | null> {
  if (!(error instanceof Error)) {
    return { error: '未知错误', errorType: null, errorCode: null, httpStatus: null }
  }
  const providerError = error as Error & { code?: string; status?: number }
  return {
    error: redactDiagnosticText(providerError.message),
    errorType: providerError.name,
    errorCode: providerError.code ?? null,
    httpStatus: providerError.status ?? null,
  }
}
