import { useState } from 'react'
import type { ArticleSnapshot, TranslationTaskState } from '../../shared/types'
import type {
  ArticleExportOptions,
  ExportArticle,
  ExportTaskState,
} from '../../shared/export/export-types'
import { DEFAULT_EXPORT_OPTIONS } from '../../shared/export/export-types'
import { generateExportFilename } from '../../shared/export/filename-generator'
import { getMissingMediaOrigins, getRequiredMediaOrigins } from '../../shared/export/media-permissions'

type ContentResponse<T> = { ok: boolean; error?: string } & T

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function initialFilename(snapshot: ArticleSnapshot): string {
  return generateExportFilename({
    title: snapshot.articleTitle,
    hostname: new URL(snapshot.url).hostname,
    extension: 'md',
  }).replace(/\.md$/, '')
}

export function ExportPanel({
  snapshot,
  translationTask,
  exportTask,
  tabId,
  targetLanguage,
  onTask,
  onError,
}: {
  snapshot: ArticleSnapshot
  translationTask: TranslationTaskState | null
  exportTask: ExportTaskState | null
  tabId: number
  targetLanguage: string
  onTask: (task: ExportTaskState) => void
  onError: (message: string) => void
}) {
  const [options, setOptions] = useState<ArticleExportOptions>(() => ({
    ...DEFAULT_EXPORT_OPTIONS,
    limits: { ...DEFAULT_EXPORT_OPTIONS.limits },
    filename: initialFilename(snapshot),
  }))
  const [expanded, setExpanded] = useState(() => Boolean(
    exportTask && !['completed', 'failed', 'cancelled'].includes(exportTask.status),
  ))
  const [advanced, setAdvanced] = useState(false)
  const [pendingArticle, setPendingArticle] = useState<ExportArticle | null>(null)
  const [pendingOrigins, setPendingOrigins] = useState<string[]>([])
  const translatedCount = translationTask?.translations?.length ?? 0
  const incomplete = options.contentMode !== 'source'
    && translatedCount < snapshot.segments.length
  const running = exportTask && !['completed', 'failed', 'cancelled'].includes(exportTask.status)

  const update = (patch: Partial<ArticleExportOptions>) => setOptions((current) => ({ ...current, ...patch }))
  const startBackgroundExport = async (
    article: ExportArticle,
    nextOptions: ArticleExportOptions,
  ) => {
    const response = await chrome.runtime.sendMessage({
      type: 'START_EXPORT', tabId, article, options: nextOptions,
    }) as { ok?: boolean; task?: ExportTaskState; error?: string }
    if (!response.ok || !response.task) throw new Error(response.error || '无法开始导出')
    onTask(response.task)
    setPendingArticle(null)
    setPendingOrigins([])
  }

  const prepareExport = async () => {
    onError('')
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'PREPARE_ARTICLE_EXPORT',
        contentMode: options.contentMode,
        targetLanguage,
      }) as ContentResponse<{ article?: ExportArticle }>
      if (!response.ok || !response.article) throw new Error(response.error || '文章导出数据生成失败')
      if (options.mediaMode === 'local') {
        const origins = getRequiredMediaOrigins(response.article.media, options)
        const missing = await getMissingMediaOrigins(origins)
        if (missing.length > 0) {
          setPendingArticle(response.article)
          setPendingOrigins(missing)
          return
        }
      }
      await startBackgroundExport(response.article, options)
    } catch (error) {
      onError(error instanceof Error ? error.message : '导出失败')
    }
  }

  const grantAndContinue = async () => {
    if (!pendingArticle) return
    try {
      const granted = await chrome.permissions.request({ origins: pendingOrigins })
      if (!granted) throw new Error('未授予媒体域名访问权限')
      await startBackgroundExport(pendingArticle, options)
    } catch (error) {
      onError(error instanceof Error ? error.message : '媒体权限请求失败')
    }
  }

  const fallbackRemote = async () => {
    if (!pendingArticle) return
    const remoteOptions = { ...options, mediaMode: 'remote' as const }
    setOptions(remoteOptions)
    try {
      await startBackgroundExport(pendingArticle, remoteOptions)
    } catch (error) {
      onError(error instanceof Error ? error.message : '导出失败')
    }
  }

  const cancel = async () => {
    if (!exportTask) return
    const response = await chrome.runtime.sendMessage({ type: 'CANCEL_EXPORT', taskId: exportTask.taskId })
    if (!response?.ok) onError(response?.error || '取消导出失败')
  }

  return (
    <section className="card collapsible-card export-card">
      <button className="module-disclosure" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span><span className="eyebrow">文章工具</span><strong>文章导出</strong><small>{translatedCount > 0 ? `可导出原文及 ${translatedCount} 段译文` : '导出原文 Markdown'}</small></span>
        <span className="disclosure-symbol">{expanded ? '−' : '+'}</span>
      </button>
      {expanded ? <div className="collapsible-body export-body">{running ? (
        <div className="export-progress" aria-live="polite">
          <strong>{exportTask.stage}</strong>
          {exportTask.totalMedia > 0 ? <p>{exportTask.completedMedia} / {exportTask.totalMedia} 个媒体 · {formatBytes(exportTask.downloadedBytes)}</p> : null}
          {exportTask.currentFilename ? <small>{exportTask.currentFilename}</small> : null}
          <div className="progress-track"><span style={{ width: `${exportTask.totalMedia ? (exportTask.completedMedia / exportTask.totalMedia) * 100 : 15}%` }} /></div>
          <button className="danger wide" onClick={() => void cancel()}>取消导出</button>
        </div>
      ) : (
        <>
          <label>内容<select value={options.contentMode} onChange={(event) => update({ contentMode: event.target.value as ArticleExportOptions['contentMode'] })}><option value="source">原文</option><option value="translated" disabled={translatedCount === 0}>译文</option><option value="bilingual" disabled={translatedCount === 0}>双语</option></select></label>
          <label>媒体<select value={options.mediaMode} onChange={(event) => update({ mediaMode: event.target.value as ArticleExportOptions['mediaMode'] })}><option value="remote">保留原始链接</option><option value="local">下载媒体到本地</option></select></label>
          <label>文件名<input value={options.filename} onChange={(event) => update({ filename: event.target.value })} /></label>
          <label className="check-row"><input type="checkbox" checked={options.includeFrontMatter} onChange={(event) => update({ includeFrontMatter: event.target.checked })} /> 包含 YAML Front Matter</label>
          {incomplete ? <p className="warning">当前只有 {translatedCount} / {snapshot.segments.length} 个段落有译文，导出内容会按未翻译策略处理。</p> : null}
          {exportTask?.status === 'completed' ? <p className="success-note">{exportTask.stage}{exportTask.failedMedia ? `；${exportTask.failedMedia} 个媒体失败` : ''}{exportTask.incompleteTranslation ? '；译文不完整' : ''}</p> : null}
          {exportTask?.status === 'failed' ? <p className="error">{exportTask.error || '导出失败'}</p> : null}
          <button className="primary wide export-submit" onClick={() => void prepareExport()}>{options.mediaMode === 'local' ? '导出 ZIP' : '导出 Markdown'}</button>
          <button className="disclosure export-disclosure" onClick={() => setAdvanced((value) => !value)}><span>高级导出设置</span><span>{advanced ? '−' : '+'}</span></button>
          {advanced ? <div className="export-advanced">
            <label>双语布局<select value={options.bilingualLayout} onChange={(event) => update({ bilingualLayout: event.target.value as ArticleExportOptions['bilingualLayout'] })}><option value="sequential">原文 + 译文标签</option><option value="blockquote">引用块译文</option><option value="divider">分隔线</option></select></label>
            <label>未翻译段落<select value={options.missingTranslationStrategy} onChange={(event) => update({ missingTranslationStrategy: event.target.value as ArticleExportOptions['missingTranslationStrategy'] })}><option value="mark-untranslated">标记并保留原文</option><option value="omit">忽略</option><option value="fallback-to-source">直接使用原文</option></select></label>
            <label>媒体失败<select value={options.mediaFailureStrategy} onChange={(event) => update({ mediaFailureStrategy: event.target.value as ArticleExportOptions['mediaFailureStrategy'] })}><option value="keep-remote-url">保留远程链接</option><option value="remove-reference">移除引用</option><option value="abort-export">中止导出</option></select></label>
            <div className="check-grid"><label><input type="checkbox" checked={options.downloadImages} onChange={(event) => update({ downloadImages: event.target.checked })} /> 图片</label><label><input type="checkbox" checked={options.downloadVideos} onChange={(event) => update({ downloadVideos: event.target.checked })} /> 视频</label><label><input type="checkbox" checked={options.downloadAudio} onChange={(event) => update({ downloadAudio: event.target.checked })} /> 音频</label><label><input type="checkbox" checked={options.downloadPosters} onChange={(event) => update({ downloadPosters: event.target.checked })} /> Video Poster</label></div>
            <label>单文件上限（MB）<input type="number" min="1" max="500" value={Math.round(options.limits.maxSingleFileBytes / 1024 / 1024)} onChange={(event) => update({ limits: { ...options.limits, maxSingleFileBytes: Number(event.target.value) * 1024 * 1024 } })} /></label>
            <label>总大小上限（MB）<input type="number" min="1" max="1000" value={Math.round(options.limits.maxTotalBytes / 1024 / 1024)} onChange={(event) => update({ limits: { ...options.limits, maxTotalBytes: Number(event.target.value) * 1024 * 1024 } })} /></label>
            <label>下载并发数<input type="number" min="1" max="8" value={options.limits.concurrency} onChange={(event) => update({ limits: { ...options.limits, concurrency: Number(event.target.value) } })} /></label>
            <label className="check-row"><input type="checkbox" checked={options.appendSourceLink} onChange={(event) => update({ appendSourceLink: event.target.checked })} /> 文末附加原文链接</label>
            <p className="hint">ZIP 在浏览器内存中生成。视频和大量媒体可能占用较多内存。</p>
          </div> : null}
        </>
      )}
      {pendingOrigins.length > 0 ? <div className="permission-box"><strong>下载媒体需要访问以下域名：</strong><ul>{pendingOrigins.map((origin) => <li key={origin}>{new URL(origin).hostname}</li>)}</ul><div className="button-grid"><button className="primary" onClick={() => void grantAndContinue()}>允许并继续</button><button className="secondary" onClick={() => void fallbackRemote()}>仅导出链接</button></div></div> : null}</div> : null}
    </section>
  )
}
