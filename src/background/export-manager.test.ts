import type { ExportArticle, ExportTaskState } from '../shared/export/export-types'
import { DEFAULT_EXPORT_OPTIONS } from '../shared/export/export-types'
import { executeArticleExport } from './export-manager'

const article: ExportArticle = {
  metadata: {
    title: 'Export test',
    sourceUrl: 'https://example.com/article',
    exportMode: 'source',
    exportedAt: '2026-07-17T10:00:00+08:00',
  },
  rootElementPath: 'article',
  media: [{
    id: 'image', type: 'image', originalUrl: '/image.png',
    resolvedUrl: 'https://cdn.example.com/image.png',
  }],
  blocks: [{
    id: 'block', type: 'media', sourceMarkdown: '![Diagram]({{AI_READER_MEDIA:image}})',
    segmentIds: [], mediaIds: ['image'],
  }],
}

function task(): ExportTaskState {
  const now = Date.now()
  return {
    taskId: 'export-1', tabId: 1, pageUrl: article.metadata.sourceUrl,
    status: 'preparing', stage: '准备', filename: 'export-test', totalMedia: 0,
    completedMedia: 0, failedMedia: 0, downloadedBytes: 0,
    incompleteTranslation: false, createdAt: now, updatedAt: now,
  }
}

describe('background export manager', () => {
  it('creates a UTF-8 Markdown browser download with absolute media URLs', async () => {
    const download = vi.fn(async (options: chrome.downloads.DownloadOptions) => {
      expect(options.filename).toBe('export-test.md')
      return 7
    })
    const previous = (globalThis as { chrome?: typeof chrome }).chrome
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { downloads: { download } },
    })
    try {
      const updates: ExportTaskState[] = []
      const result = await executeArticleExport({
        task: task(),
        article,
        options: { ...DEFAULT_EXPORT_OPTIONS, filename: 'export-test' },
        signal: new AbortController().signal,
        onUpdate: (update) => { updates.push(update) },
      })
      expect(result.status).toBe('completed')
      expect(updates.map((update) => update.status)).toContain('saving')
      expect(download).toHaveBeenCalledWith(expect.objectContaining({ filename: 'export-test.md' }))
      const url = download.mock.calls[0][0].url as string
      const markdown = atob(url.split(',')[1])
      expect(markdown).toContain('https://cdn.example.com/image.png')
    } finally {
      Object.defineProperty(globalThis, 'chrome', { configurable: true, value: previous })
    }
  })
})
