export type ExportContentMode = 'source' | 'translated' | 'bilingual'
export type MissingTranslationStrategy = 'omit' | 'fallback-to-source' | 'mark-untranslated'
export type BilingualMarkdownLayout = 'sequential' | 'blockquote' | 'divider'
export type ExportMediaMode = 'remote' | 'local'
export type MediaFailureStrategy = 'keep-remote-url' | 'remove-reference' | 'abort-export'
export type ExportMediaType = 'image' | 'video' | 'audio' | 'poster'

export interface ArticleExportMetadata {
  title: string
  sourceUrl: string
  sourceLanguage?: string
  targetLanguage?: string
  author?: string
  publishedAt?: string
  description?: string
  exportMode: ExportContentMode
  exportedAt: string
}

export type ExportTemplateToken =
  | { type: 'text'; value: string }
  | { type: 'segment'; segmentId: string; linePrefix?: string }

export interface ExportBlock {
  id: string
  type:
    | 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'table'
    | 'figure' | 'media' | 'horizontal-rule' | 'details' | 'html'
  sourceMarkdown: string
  segmentIds: string[]
  translationTemplate?: ExportTemplateToken[]
  mediaIds: string[]
}

export interface ExportMediaResource {
  id: string
  type: ExportMediaType
  originalUrl: string
  resolvedUrl: string
  mimeType?: string
  suggestedFilename?: string
  localFilename?: string
  localPath?: string
  sourceElementPath?: string
}

export interface ExportArticle {
  metadata: ArticleExportMetadata
  rootElementPath: string
  blocks: ExportBlock[]
  media: ExportMediaResource[]
}

export interface MediaDownloadLimits {
  maxSingleFileBytes: number
  maxTotalBytes: number
  maxMediaCount: number
  concurrency: number
  timeoutMs: number
}

export interface ArticleExportOptions {
  contentMode: ExportContentMode
  mediaMode: ExportMediaMode
  missingTranslationStrategy: MissingTranslationStrategy
  bilingualLayout: BilingualMarkdownLayout
  includeFrontMatter: boolean
  mediaFailureStrategy: MediaFailureStrategy
  downloadImages: boolean
  downloadVideos: boolean
  downloadAudio: boolean
  downloadPosters: boolean
  appendSourceLink: boolean
  filename: string
  limits: MediaDownloadLimits
}

export const DEFAULT_MEDIA_LIMITS: MediaDownloadLimits = {
  maxSingleFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxMediaCount: 200,
  concurrency: 3,
  timeoutMs: 30_000,
}

export const DEFAULT_EXPORT_OPTIONS: ArticleExportOptions = {
  contentMode: 'source',
  mediaMode: 'remote',
  missingTranslationStrategy: 'mark-untranslated',
  bilingualLayout: 'sequential',
  includeFrontMatter: true,
  mediaFailureStrategy: 'keep-remote-url',
  downloadImages: true,
  downloadVideos: true,
  downloadAudio: false,
  downloadPosters: true,
  appendSourceLink: false,
  filename: 'article',
  limits: DEFAULT_MEDIA_LIMITS,
}

export type ExportTaskStatus =
  | 'preparing' | 'serializing' | 'collecting-media' | 'requesting-permissions'
  | 'downloading-media' | 'rewriting-links' | 'building-archive' | 'saving'
  | 'completed' | 'failed' | 'cancelled'

export interface ExportTaskState {
  taskId: string
  tabId: number
  pageUrl: string
  status: ExportTaskStatus
  stage: string
  filename: string
  totalMedia: number
  completedMedia: number
  failedMedia: number
  downloadedBytes: number
  currentFilename?: string
  mediaFailures?: Array<{ filename: string; error: string }>
  incompleteTranslation: boolean
  errorCode?: ExportErrorCode
  error?: string
  createdAt: number
  updatedAt: number
}

export type ExportErrorCode =
  | 'ARTICLE_NOT_FOUND' | 'EMPTY_ARTICLE' | 'TRANSLATION_UNAVAILABLE'
  | 'INVALID_FILENAME' | 'PERMISSION_DENIED' | 'MEDIA_DOWNLOAD_FAILED'
  | 'MEDIA_TOO_LARGE' | 'TOTAL_SIZE_EXCEEDED' | 'ZIP_BUILD_FAILED'
  | 'DOWNLOAD_FAILED' | 'EXPORT_CANCELLED' | 'UNKNOWN'

export class ExportError extends Error {
  readonly code: ExportErrorCode

  constructor(code: ExportErrorCode, message: string) {
    super(message)
    this.name = 'ExportError'
    this.code = code
  }
}
