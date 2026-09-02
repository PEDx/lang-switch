import type {
  ArticleExportOptions,
  ExportMediaResource,
  MediaDownloadLimits,
} from './export-types'
import { ExportError } from './export-types'
import { isMediaEnabled } from './media-path-rewriter'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
}

const DEFAULT_EXTENSIONS = {
  image: 'img',
  video: 'mp4',
  audio: 'mp3',
  poster: 'jpg',
} as const

export interface DownloadedMedia {
  resource: ExportMediaResource
  data: Uint8Array
  localPath: string
}

export interface MediaDownloadFailure {
  resource: ExportMediaResource
  error: string
}

export interface MediaDownloadResult {
  downloaded: DownloadedMedia[]
  failed: MediaDownloadFailure[]
  downloadedBytes: number
}

export interface MediaDownloadProgress {
  total: number
  completed: number
  failed: number
  downloadedBytes: number
  currentFilename?: string
}

function extensionFromUrl(url: string): string | undefined {
  if (url.startsWith('data:')) return undefined
  try {
    return /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1].toLowerCase()
  } catch {
    return undefined
  }
}

export function extensionForMedia(
  resource: ExportMediaResource,
  contentType?: string,
): string {
  const mime = contentType?.split(';')[0].trim().toLowerCase()
  return (mime && MIME_EXTENSIONS[mime])
    || extensionFromUrl(resource.resolvedUrl)
    || (resource.mimeType && MIME_EXTENSIONS[resource.mimeType.split(';')[0].trim().toLowerCase()])
    || DEFAULT_EXTENSIONS[resource.type]
}

function createLocalFilename(
  resource: ExportMediaResource,
  contentType: string | undefined,
  used: Set<string>,
): string {
  const extension = extensionForMedia(resource, contentType)
  const preferredBase = (resource.suggestedFilename ?? resource.type)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || resource.type
  let candidate = `${preferredBase}.${extension}`
  let suffix = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${preferredBase}-${suffix}.${extension}`
    suffix += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

async function readResponse(
  response: Response,
  limits: MediaDownloadLimits,
  totals: { value: number },
  signal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > limits.maxSingleFileBytes) {
    throw new ExportError('MEDIA_TOO_LARGE', '媒体文件超过单文件大小限制')
  }
  if (contentLength > 0 && totals.value + contentLength > limits.maxTotalBytes) {
    throw new ExportError('TOTAL_SIZE_EXCEEDED', '媒体总大小超过限制')
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limits.maxSingleFileBytes) throw new ExportError('MEDIA_TOO_LARGE', '媒体文件超过单文件大小限制')
    if (totals.value + bytes.byteLength > limits.maxTotalBytes) throw new ExportError('TOTAL_SIZE_EXCEEDED', '媒体总大小超过限制')
    totals.value += bytes.byteLength
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let fileBytes = 0
  while (true) {
    if (signal.aborted) throw new ExportError('EXPORT_CANCELLED', '导出已取消')
    const { done, value } = await reader.read()
    if (done) break
    fileBytes += value.byteLength
    if (fileBytes > limits.maxSingleFileBytes) {
      await reader.cancel()
      throw new ExportError('MEDIA_TOO_LARGE', '媒体文件超过单文件大小限制')
    }
    if (totals.value + value.byteLength > limits.maxTotalBytes) {
      await reader.cancel()
      throw new ExportError('TOTAL_SIZE_EXCEEDED', '媒体总大小超过限制')
    }
    totals.value += value.byteLength
    chunks.push(value)
  }
  const result = new Uint8Array(fileBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export async function downloadMediaResources(input: {
  resources: ExportMediaResource[]
  options: ArticleExportOptions
  signal: AbortSignal
  fetcher?: typeof fetch
  onProgress?: (progress: MediaDownloadProgress) => void | Promise<void>
}): Promise<MediaDownloadResult> {
  const groupController = new AbortController()
  const abortGroup = () => groupController.abort()
  if (input.signal.aborted) groupController.abort()
  else input.signal.addEventListener('abort', abortGroup, { once: true })
  const selected = input.resources.filter((resource) => isMediaEnabled(resource, input.options))
  const withinLimit = selected.slice(0, input.options.limits.maxMediaCount)
  const overflow = selected.slice(input.options.limits.maxMediaCount)
  const failed: MediaDownloadFailure[] = overflow.map((resource) => ({
    resource,
    error: '超过媒体数量限制',
  }))
  const downloaded: DownloadedMedia[] = []
  const totals = { value: 0 }
  const usedNames = new Set<string>()
  const fetcher = input.fetcher ?? fetch
  let cursor = 0
  let completed = overflow.length

  const notify = (currentFilename?: string) => input.onProgress?.({
    total: selected.length,
    completed,
    failed: failed.length,
    downloadedBytes: totals.value,
    currentFilename,
  })

  const worker = async () => {
    while (cursor < withinLimit.length) {
      if (groupController.signal.aborted) throw new ExportError('EXPORT_CANCELLED', '导出已取消')
      const resource = withinLimit[cursor]
      cursor += 1
      await notify(resource.suggestedFilename)
      const controller = new AbortController()
      const abort = () => controller.abort()
      groupController.signal.addEventListener('abort', abort, { once: true })
      let timedOut = false
      const timeout = globalThis.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, input.options.limits.timeoutMs)
      try {
        const response = await fetcher(resource.resolvedUrl, {
          signal: controller.signal,
          redirect: 'follow',
          credentials: 'omit',
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const contentType = response.headers.get('content-type') ?? resource.mimeType
        const data = await readResponse(response, input.options.limits, totals, controller.signal)
        const localFilename = createLocalFilename(resource, contentType, usedNames)
        const localized = {
          ...resource,
          mimeType: contentType ?? resource.mimeType,
          localFilename,
          localPath: `media/${localFilename}`,
        }
        downloaded.push({ resource: localized, data, localPath: localized.localPath })
      } catch (error) {
        const cancelled = input.signal.aborted
        if (cancelled) throw new ExportError('EXPORT_CANCELLED', '导出已取消')
        const message = timedOut
          ? '媒体请求超时'
          : error instanceof ExportError
            ? error.message
            : error instanceof Error ? error.message : '媒体下载失败'
        failed.push({ resource, error: message })
        if (input.options.mediaFailureStrategy === 'abort-export') {
          groupController.abort()
          throw error instanceof ExportError
            ? error
            : new ExportError('MEDIA_DOWNLOAD_FAILED', message)
        }
      } finally {
        globalThis.clearTimeout(timeout)
        groupController.signal.removeEventListener('abort', abort)
        completed += 1
        await notify(resource.suggestedFilename)
      }
    }
  }

  try {
    await Promise.all(Array.from(
      { length: Math.min(input.options.limits.concurrency, Math.max(1, withinLimit.length)) },
      () => worker(),
    ))
    return { downloaded, failed, downloadedBytes: totals.value }
  } finally {
    input.signal.removeEventListener('abort', abortGroup)
  }
}
