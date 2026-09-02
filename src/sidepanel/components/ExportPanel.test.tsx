import { renderToStaticMarkup } from 'react-dom/server'
import type { ArticleSnapshot } from '../../shared/types'
import type { ExportTaskState } from '../../shared/export/export-types'
import { ExportPanel } from './ExportPanel'

const snapshot: ArticleSnapshot = {
  region: {
    selector: 'article', elementId: 'article-1', confidence: 0.9,
    textLength: 120, paragraphCount: 1, headingCount: 1, reasons: [],
  },
  segments: [{
    id: 'segment-1', tagName: 'p', sourceText: 'Hello',
    elementPath: 'article > p', order: 0,
  }],
  pageTitle: 'Example',
  articleTitle: 'Example',
  url: 'https://example.com/article',
}

function render(exportTask: ExportTaskState | null): string {
  return renderToStaticMarkup(<ExportPanel
    snapshot={snapshot}
    translationTask={null}
    exportTask={exportTask}
    tabId={1}
    targetLanguage="zh-CN"
    onTask={() => undefined}
    onError={() => undefined}
  />)
}

describe('ExportPanel disclosure', () => {
  it('is collapsed by default', () => {
    const html = render(null)
    expect(html).toContain('文章导出')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('包含 YAML Front Matter')
  })

  it('opens automatically when restoring an active export', () => {
    const task: ExportTaskState = {
      taskId: 'export-1', tabId: 1, pageUrl: snapshot.url,
      status: 'downloading-media', stage: '正在下载媒体', filename: 'example',
      totalMedia: 2, completedMedia: 1, failedMedia: 0, downloadedBytes: 1_024,
      incompleteTranslation: false, createdAt: 1, updatedAt: 1,
    }
    const html = render(task)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('取消导出')
  })
})
