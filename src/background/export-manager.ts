import type { SegmentTranslation } from '../shared/types'
import { articleExportOptionsSchema, exportArticleSchema } from '../shared/export/export-schemas'
import { ExportError } from '../shared/export/export-types'
import type {
  ArticleExportOptions,
  ExportArticle,
  ExportTaskState,
} from '../shared/export/export-types'
import { renderArticleMarkdown } from '../shared/export/markdown-renderer'
import { downloadMediaResources } from '../shared/export/media-downloader'
import { isMediaEnabled, rewriteMediaPaths } from '../shared/export/media-path-rewriter'
import { buildExportZip } from '../shared/export/zip-builder'
import { getMissingMediaOrigins, getRequiredMediaOrigins } from '../shared/export/media-permissions'
import { validateUserFilename } from '../shared/export/filename-generator'

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const size = 0x8000
  for (let offset = 0; offset < bytes.length; offset += size) {
    const slice = bytes.subarray(offset, Math.min(offset + size, bytes.length))
    chunks.push(String.fromCharCode(...slice))
  }
  return btoa(chunks.join(''))
}

async function saveBytes(bytes: Uint8Array, mimeType: string, filename: string): Promise<void> {
  try {
    const url = `data:${mimeType};base64,${bytesToBase64(bytes)}`
    await chrome.downloads.download({ url, filename, saveAs: true, conflictAction: 'uniquify' })
  } catch (error) {
    throw new ExportError('DOWNLOAD_FAILED', error instanceof Error ? error.message : '浏览器下载失败')
  }
}

export async function executeArticleExport(input: {
  task: ExportTaskState
  article: unknown
  options: unknown
  translations?: SegmentTranslation[]
  signal: AbortSignal
  onUpdate: (task: ExportTaskState) => void | Promise<void>
}): Promise<ExportTaskState> {
  const article: ExportArticle = exportArticleSchema.parse(input.article)
  const options: ArticleExportOptions = articleExportOptionsSchema.parse(input.options)
  const baseFilename = validateUserFilename(options.filename)
  let task = input.task
  const update = async (
    status: ExportTaskState['status'],
    stage: string,
    patch: Partial<ExportTaskState> = {},
  ) => {
    task = { ...task, ...patch, status, stage, updatedAt: Date.now() }
    await input.onUpdate(task)
  }
  const checkCancelled = () => {
    if (input.signal.aborted) throw new ExportError('EXPORT_CANCELLED', '导出已取消')
  }

  await update('serializing', '正在生成 Markdown')
  checkCancelled()
  const rendered = renderArticleMarkdown({ article, translations: input.translations, options })
  task = { ...task, incompleteTranslation: rendered.incompleteTranslation }

  if (options.mediaMode === 'remote') {
    await update('rewriting-links', '正在修正媒体链接')
    const markdown = rewriteMediaPaths({
      markdown: rendered.markdown,
      resources: article.media,
      failureStrategy: 'keep-remote-url',
    })
    await update('saving', '正在保存 Markdown')
    await saveBytes(new TextEncoder().encode(markdown), 'text/markdown;charset=utf-8', `${baseFilename}.md`)
    await update('completed', '导出完成')
    return task
  }

  await update('requesting-permissions', '正在检查媒体访问权限')
  const origins = getRequiredMediaOrigins(article.media, options)
  const missingOrigins = await getMissingMediaOrigins(origins)
  if (missingOrigins.length > 0) {
    throw new ExportError('PERMISSION_DENIED', '媒体访问权限不足，请重新允许媒体域名')
  }

  await update('downloading-media', '正在下载媒体', {
    totalMedia: article.media.filter((resource) => isMediaEnabled(resource, options)).length,
  })
  const media = await downloadMediaResources({
    resources: article.media,
    options,
    signal: input.signal,
    onProgress: (progress) => update('downloading-media', `正在下载媒体 ${progress.completed} / ${progress.total}`, {
      totalMedia: progress.total,
      completedMedia: progress.completed,
      failedMedia: progress.failed,
      downloadedBytes: progress.downloadedBytes,
      currentFilename: progress.currentFilename,
    }),
  })
  checkCancelled()
  await update('rewriting-links', '正在改写媒体路径', {
    completedMedia: media.downloaded.length + media.failed.length,
    failedMedia: media.failed.length,
    downloadedBytes: media.downloadedBytes,
    mediaFailures: media.failed.map((failure) => ({
      filename: failure.resource.suggestedFilename ?? failure.resource.type,
      error: failure.error,
    })),
  })
  const localPaths = new Map(media.downloaded.map((item) => [item.resource.id, item.localPath]))
  const markdown = rewriteMediaPaths({
    markdown: rendered.markdown,
    resources: article.media,
    localPaths,
    failureStrategy: options.mediaFailureStrategy,
  })
  await update('building-archive', '正在生成 ZIP')
  const zip = buildExportZip({ markdown, markdownFilename: baseFilename, media: media.downloaded })
  checkCancelled()
  await update('saving', '正在保存 ZIP')
  await saveBytes(zip, 'application/zip', `${baseFilename}.zip`)
  await update('completed', media.failed.length > 0
    ? `导出完成，${media.failed.length} 个媒体下载失败并已按策略处理`
    : '导出完成')
  return task
}
