import type { ExportMediaResource, ExportMediaType } from './export-types'

const SAFE_REMOTE_PROTOCOLS = new Set(['http:', 'https:'])
const UNSUPPORTED_STREAM_EXTENSION = /\.(?:m3u8|mpd)(?:$|[?#])/i
const MAX_DATA_IMAGE_LENGTH = 1_400_000

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function normalizeExportUrl(
  raw: string | null | undefined,
  baseUrl: string,
  options: { allowDataImage?: boolean } = {},
): string | null {
  const value = raw?.trim()
  if (!value) return null
  if (options.allowDataImage && /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value)) {
    return value.length <= MAX_DATA_IMAGE_LENGTH ? value : null
  }
  try {
    const url = new URL(value, baseUrl)
    if (!SAFE_REMOTE_PROTOCOLS.has(url.protocol)) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

export function normalizePageLink(raw: string | null | undefined, baseUrl: string): string | null {
  const value = raw?.trim()
  if (!value) return null
  if (value.startsWith('#')) return value
  try {
    const url = new URL(value, baseUrl)
    return SAFE_REMOTE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

interface SrcsetCandidate {
  url: string
  score: number
}

export function parseSrcset(srcset: string): SrcsetCandidate[] {
  return srcset.split(',').map((part) => {
    const tokens = part.trim().split(/\s+/)
    const descriptor = tokens[1] ?? '1x'
    const numeric = Number.parseFloat(descriptor)
    return { url: tokens[0] ?? '', score: Number.isFinite(numeric) ? numeric : 1 }
  }).filter((candidate) => candidate.url)
}

export function selectImageUrl(image: HTMLImageElement): string | null {
  if (image.currentSrc) return image.currentSrc
  const srcsets = [
    ...[...(image.closest('picture')?.querySelectorAll('source[srcset]') ?? [])]
      .map((source) => source.getAttribute('srcset') ?? ''),
    image.getAttribute('srcset') ?? '',
  ]
  const candidates = srcsets.flatMap(parseSrcset).sort((a, b) => b.score - a.score)
  return candidates[0]?.url || image.getAttribute('src')
}

function urlExtension(url: string): string | undefined {
  if (url.startsWith('data:')) {
    const mime = /^data:([^;,]+)/i.exec(url)?.[1]
    return mime?.split('/')[1]?.replace('jpeg', 'jpg')
  }
  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)
    return match?.[1].toLowerCase()
  } catch {
    return undefined
  }
}

export function mediaPlaceholder(id: string): string {
  return `{{AI_READER_MEDIA:${id}}}`
}

export class MediaCollector {
  private readonly baseUrl: string
  private readonly byUrl = new Map<string, ExportMediaResource>()
  private readonly counters: Record<ExportMediaType, number> = {
    image: 0,
    video: 0,
    audio: 0,
    poster: 0,
  }

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  add(input: {
    type: ExportMediaType
    url: string | null | undefined
    mimeType?: string
    sourceElementPath?: string
  }): ExportMediaResource | null {
    const resolvedUrl = normalizeExportUrl(input.url, this.baseUrl, {
      allowDataImage: input.type === 'image' || input.type === 'poster',
    })
    if (!resolvedUrl || UNSUPPORTED_STREAM_EXTENSION.test(resolvedUrl)) return null
    const existing = this.byUrl.get(resolvedUrl)
    if (existing) return existing
    const index = ++this.counters[input.type]
    const extension = urlExtension(resolvedUrl)
    const suggestedFilename = `${input.type}-${String(index).padStart(3, '0')}${extension ? `.${extension}` : ''}`
    const resource: ExportMediaResource = {
      id: `media-${stableHash(resolvedUrl)}`,
      type: input.type,
      originalUrl: input.url?.trim() ?? resolvedUrl,
      resolvedUrl,
      mimeType: input.mimeType,
      suggestedFilename,
      sourceElementPath: input.sourceElementPath,
    }
    this.byUrl.set(resolvedUrl, resource)
    return resource
  }

  list(): ExportMediaResource[] {
    return [...this.byUrl.values()]
  }
}
