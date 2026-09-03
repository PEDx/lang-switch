import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ArticleSnapshot,
  DiagnosticLogEntry,
  DisplayMode,
  TranslationDisplayStyle,
  TranslationFont,
  ThemeMode,
  SiteRule,
  TranslationTaskState,
  UserSettings,
} from '../shared/types'
import type { ExportTaskState } from '../shared/export/export-types'
import {
  getSettings,
  getProviders,
  getSiteRules,
  saveSettings,
  saveSiteRules,
} from '../shared/storage'
import { getProviderOriginPattern, requestHostPermissions } from '../shared/api/provider-permissions'
import { resolveTranslationProviders, uniqueTranslationProviders } from '../shared/api/provider-routing'
import { ExportPanel } from './components/ExportPanel'
import { TranslationMonitor } from './components/TranslationMonitor'
import { requiresArticleRegionConfirmation } from '../shared/article-region-guard'
import { createExactPathnamePattern } from '../shared/site-rule-utils'
import { Icon } from './icons'

type ContentResponse<T = unknown> = { ok: boolean; error?: string } & T

function isTranslationActive(task: TranslationTaskState | null): boolean {
  return Boolean(task && !['completed', 'failed', 'cancelled'].includes(task.status))
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('无法访问当前标签页')
  return tab
}

async function sendToPage<T>(message: object): Promise<T> {
  const tab = await activeTab()
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tab.id!, message) as T
    } catch (error) {
      lastError = error
      if (!(error instanceof Error) || !/Receiving end does not exist|Could not establish connection|message port closed/i.test(error.message)) throw error
      await new Promise((resolve) => window.setTimeout(resolve, 100))
    }
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] })
    await new Promise((resolve) => window.setTimeout(resolve, 100))
    return await chrome.tabs.sendMessage(tab.id!, message) as T
  } catch (error) {
    if (error instanceof Error && /Cannot access contents of the page|manifest must request permission|The extensions gallery cannot be scripted/i.test(error.message)) {
      throw new Error('当前页面不允许扩展访问，请在普通 HTTP/HTTPS 文章页面中使用 Lang Switch。', { cause: error })
    }
    if (error instanceof Error && /Receiving end does not exist|Could not establish connection|message port closed/i.test(error.message) && lastError instanceof Error) throw lastError
    throw error
  }
}

export function App() {
  const [snapshot, setSnapshot] = useState<ArticleSnapshot | null>(null)
  const [task, setTask] = useState<TranslationTaskState | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selector, setSelector] = useState('')
  const [selectorStatus, setSelectorStatus] = useState('')
  const [currentTabId, setCurrentTabId] = useState<number | null>(null)
  const currentTabIdRef = useRef<number | null>(null)
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([])
  const [exportTask, setExportTask] = useState<ExportTaskState | null>(null)
  const [providerOrigins, setProviderOrigins] = useState<string[]>([])
  const [confirmedPartialSelector, setConfirmedPartialSelector] = useState<string | null>(null)
  const [pageAccessRequired, setPageAccessRequired] = useState(false)

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.themeMode
  }, [settings])

  const detect = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const tab = await activeTab()
      setCurrentTabId(tab.id!)
      currentTabIdRef.current = tab.id!
      const [response, storedSettings, taskResponse, logResponse, exportResponse, providers] = await Promise.all([
        sendToPage<ContentResponse<{ snapshot: ArticleSnapshot | null }>>({ type: 'DETECT_ARTICLE' }),
        getSettings(),
        chrome.runtime.sendMessage({ type: 'GET_TASK', tabId: tab.id }) as Promise<{ task?: TranslationTaskState }>,
        chrome.runtime.sendMessage({ type: 'GET_DIAGNOSTIC_LOGS', tabId: tab.id }) as Promise<{ logs?: DiagnosticLogEntry[] }>,
        chrome.runtime.sendMessage({ type: 'GET_EXPORT_TASK', tabId: tab.id }) as Promise<{ task?: ExportTaskState }>,
        getProviders(),
      ])
      setSettings(storedSettings)
      const matchingTask = taskResponse.task?.pageUrl === response.snapshot?.url
        ? taskResponse.task
        : undefined
      const resolvedProviders = resolveTranslationProviders(
        providers,
        storedSettings,
        matchingTask?.providerId,
      )
      setProviderOrigins(resolvedProviders
        ? uniqueTranslationProviders(resolvedProviders).map(getProviderOriginPattern)
        : [])
      if (!response.ok || !response.snapshot) throw new Error(response.error || '未能可靠识别文章主体')
      setTask(taskResponse.task?.pageUrl === response.snapshot.url ? taskResponse.task : null)
      setLogs(logResponse.logs ?? [])
      setExportTask(exportResponse.task?.pageUrl === response.snapshot.url ? exportResponse.task : null)
      setSnapshot(response.snapshot)
      setSelector(response.snapshot.region.selector)
      setConfirmedPartialSelector(null)
      setPageAccessRequired(false)
    } catch (caught) {
      setPageAccessRequired(caught instanceof Error && /Cannot access contents of the page|manifest must request permission|The extensions gallery cannot be scripted/i.test(caught.message))
      setError(caught instanceof Error ? caught.message : '文章识别失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const requestPageAccess = async () => {
    try {
      const tab = await activeTab()
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('当前页面不是普通 HTTP/HTTPS 网页，Chrome 不允许扩展访问。')
      const origin = `${new URL(tab.url).origin}/*`
      const granted = await chrome.permissions.request({ origins: [origin] })
      if (!granted) throw new Error('未授予当前网站访问权限')
      setPageAccessRequired(false)
      await detect()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '申请网站访问权限失败')
    }
  }

  useEffect(() => {
    const detectTimer = window.setTimeout(() => void detect(), 0)
    const listener = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return
      const value = message as { type: string; task?: TranslationTaskState | ExportTaskState; selector?: string; entry?: DiagnosticLogEntry }
      if (value.type === 'TASK_UPDATED' && value.task) setTask(value.task as TranslationTaskState)
      if (value.type === 'EXPORT_UPDATED' && value.task) setExportTask(value.task as ExportTaskState)
      if (
        value.type === 'DIAGNOSTIC_LOG_UPDATED' &&
        value.entry &&
        (value.entry.tabId === undefined || value.entry.tabId === currentTabIdRef.current)
      ) {
        setLogs((entries) => [...entries, value.entry!].slice(-500))
      }
      if (value.type === 'REGION_SELECTED' && value.selector) {
        setSelector(value.selector)
        setConfirmedPartialSelector(null)
        void sendToPage<ContentResponse<{ snapshot: ArticleSnapshot }>>({ type: 'USE_SELECTOR', selector: value.selector })
          .then((response) => response.snapshot && setSnapshot(response.snapshot))
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      window.clearTimeout(detectTimer)
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [detect])

  const start = async () => {
    setError('')
    if (!snapshot) return setError('尚未识别文章主体')
    const partialConfirmed = confirmedPartialSelector === snapshot.region.selector
    if (requiresArticleRegionConfirmation(snapshot) && !partialConfirmed) {
      return setError('当前只选择了文章的一部分，请先确认翻译范围')
    }
    if (providerOrigins.length === 0) return setError('尚未配置模型 Provider')
    if (!await requestHostPermissions(providerOrigins)) return setError('未授予全部阶段模型服务域名的访问权限')
    const tab = await activeTab()
    const response = await chrome.runtime.sendMessage({
      type: 'START_TRANSLATION',
      tabId: tab.id,
      allowPartialRegion: partialConfirmed,
    })
    if (!response?.ok) setError(response?.error || '无法开始翻译')
  }

  const setStatus = async (type: 'PAUSE_TRANSLATION' | 'RESUME_TRANSLATION' | 'STOP_TRANSLATION') => {
    if (!task) return
    if (type === 'RESUME_TRANSLATION' && providerOrigins.length > 0 && !await requestHostPermissions(providerOrigins)) {
      setError('未授予全部阶段模型服务域名的访问权限')
      return
    }
    const response = await chrome.runtime.sendMessage({ type, taskId: task.taskId })
    if (!response?.ok) setError(response?.error || '任务操作失败')
    if (response?.task) setTask(response.task)
  }

  const changeDisplay = async (
    mode: DisplayMode,
    opacity = settings?.originalOpacity ?? 0.32,
    translationStyle: TranslationDisplayStyle = settings?.translationDisplayStyle ?? 'highlight',
    translationLineHeight = settings?.translationLineHeight ?? null,
    translationFont: TranslationFont = settings?.translationFont ?? 'default',
  ) => {
    if (!settings) return
    const next = {
      ...settings,
      displayMode: mode,
      originalOpacity: opacity,
      translationDisplayStyle: translationStyle,
      translationLineHeight,
      translationFont,
    }
    setSettings(next)
    await Promise.all([
      saveSettings(next),
      sendToPage({
        type: 'SET_DISPLAY_MODE', mode, opacity,
        translationStyle, translationLineHeight, translationFont,
      }),
    ])
  }

  const restore = async () => {
    const tab = await activeTab()
    if (task && !['completed', 'failed', 'cancelled'].includes(task.status)) {
      await setStatus('STOP_TRANSLATION')
    }
    await Promise.all([
      sendToPage({ type: 'RESTORE_PAGE' }),
      chrome.runtime.sendMessage({ type: 'CLEAR_TASK', tabId: tab.id }),
    ])
    setTask(null)
  }

  const validateSelector = async () => {
    const response = await sendToPage<ContentResponse<{ result: { valid: boolean; message: string; matchCount: number; textLength?: number; paragraphCount?: number } }>>({ type: 'PREVIEW_SELECTOR', selector })
    setSelectorStatus(response.result?.message ?? response.error ?? '校验失败')
  }

  const applySelector = async () => {
    const response = await sendToPage<ContentResponse<{ snapshot: ArticleSnapshot }>>({ type: 'USE_SELECTOR', selector })
    if (!response.ok) return setSelectorStatus(response.error || '区域不可用')
    setSnapshot(response.snapshot)
    setConfirmedPartialSelector(null)
    setSelectorStatus('已使用此区域')
  }

  const saveRule = async () => {
    const tab = await activeTab()
    if (!tab.url) return
    const url = new URL(tab.url)
    const rules = await getSiteRules()
    const pathnamePattern = createExactPathnamePattern(url.pathname)
    const old = rules.find((rule) =>
      rule.hostname === url.hostname && rule.pathnamePattern === pathnamePattern,
    ) ?? rules.find((rule) =>
      rule.hostname === url.hostname && !rule.pathnamePattern && rule.selector === selector,
    )
    const now = Date.now()
    const rule: SiteRule = {
      id: old?.id ?? crypto.randomUUID(), hostname: url.hostname, pathnamePattern, selector,
      createdAt: old?.createdAt ?? now, updatedAt: now,
    }
    await saveSiteRules([...rules.filter((item) => item.id !== rule.id), rule])
    setSelectorStatus('站点规则已保存')
  }

  const resetRegion = async () => {
    if (isTranslationActive(task)) {
      setError('请先停止当前翻译任务，再恢复自动识别区域')
      return
    }
    setError('')
    try {
      const tab = await activeTab()
      if (snapshot?.regionSource === 'site-rule' && tab.url) {
        const hostname = new URL(tab.url).hostname
        const rules = await getSiteRules()
        await saveSiteRules(rules.filter((rule) =>
          rule.hostname !== hostname || rule.selector !== snapshot.region.selector,
        ))
      }
      await Promise.all([
        sendToPage({ type: 'RESTORE_PAGE' }),
        chrome.runtime.sendMessage({ type: 'CLEAR_TASK', tabId: tab.id }),
      ])
      const response = await sendToPage<ContentResponse<{ snapshot: ArticleSnapshot | null }>>({
        type: 'RESET_ARTICLE_REGION',
      })
      if (!response.ok || !response.snapshot) throw new Error(response.error || '自动识别失败')
      setSnapshot(response.snapshot)
      setSelector(response.snapshot.region.selector)
      setSelectorStatus('已恢复自动识别')
      setConfirmedPartialSelector(null)
      setTask(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复自动识别失败')
    }
  }

  const advanced = settings?.advancedMode ?? false
  const running = isTranslationActive(task)
  const partialCoverage = snapshot?.regionCoverage?.requiresConfirmation
    ? snapshot.regionCoverage
    : null
  const partialRegionConfirmed = Boolean(
    partialCoverage && confirmedPartialSelector === snapshot?.region.selector,
  )
  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const effectiveDark = settings?.themeMode === 'dark' || (settings?.themeMode === 'system' && prefersDark)

  return (
    <main className="panel-shell">
      <header className="brand-row">
        <div><img className="brand-logo" src="/brand/lang-switch-mark.png" alt="" /><div><h1>Lang Switch</h1><p>长文 AI 精译与双语阅读</p></div></div>
        <div className="header-actions">
          <button className="icon-button" title="设置" onClick={() => chrome.runtime.openOptionsPage()}><Icon name="settings" /></button>
          <button className="icon-button" title={effectiveDark ? '切换到浅色模式' : '切换到深色模式'} aria-label="切换主题" onClick={() => {
            if (!settings) return
            const nextMode: ThemeMode = effectiveDark ? 'light' : 'dark'
            const next = { ...settings, themeMode: nextMode }
            setSettings(next)
            void saveSettings(next)
        }}><Icon name={effectiveDark ? 'sun' : 'moon'} /></button>
        </div>
      </header>

      {loading ? <section className="card skeleton">正在识别文章主体…</section> : null}
      {error ? <section className="card error-card"><strong>{error}</strong>{pageAccessRequired ? <button className="primary" onClick={() => void requestPageAccess()}>允许访问当前网站</button> : null}<button className="text-button" onClick={() => void detect()}>重新识别</button></section> : null}
      {snapshot ? (
        <section className="card region-card">
          <div className="eyebrow">文章区域</div>
          <h2>{snapshot.regionSource === 'manual' ? '已使用手动区域' : snapshot.regionSource === 'site-rule' ? '已使用本站规则' : snapshot.region.confidence < 0.35 ? '识别置信度较低' : '已自动识别'}</h2>
          <code title={snapshot.region.selector}>{snapshot.region.selector}</code>
          <div className="scale-line"><span>{snapshot.region.paragraphCount} 个段落</span><span>{snapshot.region.textLength.toLocaleString()} 字符</span><span>{Math.round(snapshot.region.confidence * 100)}% 置信度</span></div>
          {snapshot.siteRuleWarning ? <p className="warning">{snapshot.siteRuleWarning}</p> : null}
          {partialCoverage ? <div className="region-warning" role="alert">
            <strong>当前只选择了全文的一部分</strong>
            <p>{snapshot.regionWarning}</p>
            <div className="region-comparison">
              <span>当前区域<strong>{snapshot.segments.length} 个可翻译段落 · {Math.round(partialCoverage.ratio * 100)}%</strong></span>
              <span>自动识别全文<strong>{partialCoverage.automaticParagraphCount} 段 · {partialCoverage.automaticSelector}</strong></span>
            </div>
            {partialCoverage.firstHeading ? <p className="region-boundary">当前章节：{partialCoverage.firstHeading}{partialCoverage.lastHeading && partialCoverage.lastHeading !== partialCoverage.firstHeading ? ` → ${partialCoverage.lastHeading}` : ''}</p> : null}
            <div className="button-grid region-actions">
              <button className="primary" onClick={() => void resetRegion()}>恢复全文</button>
              <button className="secondary" onClick={() => { setConfirmedPartialSelector(snapshot.region.selector); setError('') }}>{partialRegionConfirmed ? '已确认当前区域' : `仍翻译当前 ${snapshot.segments.length} 段`}</button>
            </div>
          </div> : snapshot.regionWarning ? <div className="region-warning"><strong>区域可能不完整</strong><p>{snapshot.regionWarning}</p></div> : null}
          {(snapshot.regionSource !== 'automatic' || snapshot.siteRuleWarning) && !partialCoverage ? <button className="text-button region-reset" onClick={() => void resetRegion()}>恢复自动识别{snapshot.regionSource === 'site-rule' ? '并清除此规则' : ''}</button> : null}
        </section>
      ) : null}

      {task ? <TranslationMonitor key={task.taskId} task={task} logs={logs} displayMode={settings?.displayMode} onClear={() => {
        if (currentTabId === null) return
        void chrome.runtime.sendMessage({ type: 'CLEAR_DIAGNOSTIC_LOGS', tabId: currentTabId })
        setLogs([])
      }} /> : null}

      {settings && snapshot ? (
        <section className="card controls">
          <label>源语言<select defaultValue="auto" disabled><option value="auto">自动检测</option></select></label>
          <label>目标语言<select value={settings.defaultTargetLanguage} onChange={(event) => { const next = { ...settings, defaultTargetLanguage: event.target.value }; setSettings(next); void saveSettings(next) }}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="en">English</option></select></label>
          <label>显示方式<select value={settings.displayMode} onChange={(event) => void changeDisplay(event.target.value as DisplayMode)}><option value="bilingual">双语</option><option value="translation">仅译文</option><option value="original">仅原文</option></select></label>
          <label>翻译模式<select value="precision" disabled><option value="precision">精译</option></select></label>
        </section>
      ) : null}

      {running ? (
        <div className="button-grid">
          {task?.status === 'paused' ? <button className="primary" onClick={() => void setStatus('RESUME_TRANSLATION')}>继续</button> : <button className="secondary" onClick={() => void setStatus('PAUSE_TRANSLATION')}>暂停</button>}
          <button className="danger" onClick={() => void setStatus('STOP_TRANSLATION')}>停止</button>
        </div>
      ) : snapshot ? <button className="primary wide" disabled={Boolean(partialCoverage && !partialRegionConfirmed)} onClick={() => void start()}>{partialCoverage && !partialRegionConfirmed ? '请先确认文章区域' : task ? '重新精译' : '开始精译'}</button> : null}

      {task && settings ? (
        <section className="card display-card">
          <div className="eyebrow">阅读显示</div>
          <div className="segmented">{(['bilingual', 'translation', 'original'] as DisplayMode[]).map((mode) => <button key={mode} className={settings.displayMode === mode ? 'active' : ''} onClick={() => void changeDisplay(mode)}>{mode === 'bilingual' ? '双语' : mode === 'translation' ? '仅译文' : '仅原文'}</button>)}</div>
          <label>原文透明度 <output>{Math.round(settings.originalOpacity * 100)}%</output><input type="range" min="10" max="100" value={Math.round(settings.originalOpacity * 100)} onChange={(event) => void changeDisplay(settings.displayMode, Number(event.target.value) / 100)} /></label>
          <div className="display-options">
            <label>译文样式<select value={settings.translationDisplayStyle} onChange={(event) => void changeDisplay(settings.displayMode, settings.originalOpacity, event.target.value as TranslationDisplayStyle)}><option value="immersive">沉浸模式</option><option value="highlight">突出模式</option></select></label>
            <label>译文行高 <output>{settings.translationLineHeight === null ? 'normal' : settings.translationLineHeight.toFixed(2)}</output><input type="range" min="1" max="3" step="0.05" value={settings.translationLineHeight ?? 1.5} onChange={(event) => void changeDisplay(settings.displayMode, settings.originalOpacity, settings.translationDisplayStyle, Number(event.target.value), settings.translationFont)} /></label>
            <button className="text-button" onClick={() => void changeDisplay(settings.displayMode, settings.originalOpacity, settings.translationDisplayStyle, null, settings.translationFont)}>恢复默认行高（normal）</button>
            <label>译文字体<select value={settings.translationFont} onChange={(event) => void changeDisplay(settings.displayMode, settings.originalOpacity, settings.translationDisplayStyle, settings.translationLineHeight, event.target.value as TranslationFont)}><option value="default">系统默认</option><option value="serif">宋体</option><option value="sans">无衬线</option></select></label>
          </div>
          <button className="secondary wide" onClick={() => void restore()}>恢复原页面</button>
        </section>
      ) : null}

      {snapshot && settings && currentTabId !== null ? <ExportPanel
        key={snapshot.url}
        snapshot={snapshot}
        translationTask={task}
        exportTask={exportTask}
        tabId={currentTabId}
        targetLanguage={settings.defaultTargetLanguage}
        onTask={setExportTask}
        onError={setError}
      /> : null}

      {settings ? <section className="card collapsible-card advanced-section">
        <button className="module-disclosure" aria-expanded={advanced} onClick={() => { const next = { ...settings, advancedMode: !advanced }; setSettings(next); void saveSettings(next) }}>
          <span><span className="eyebrow">文章工具</span><strong>高级模式</strong><small>区域选择、CSS Selector 与站点规则</small></span>
          <span className="disclosure-symbol">{advanced ? '−' : '+'}</span>
        </button>
        {advanced ? <div className="collapsible-body advanced-body"><button className="secondary wide" onClick={() => void sendToPage({ type: 'START_REGION_PICKER' })}>在页面中选择区域</button><label>CSS 选择器<input value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="article.post-content" /></label><p className="hint">{selectorStatus || '第一版仅支持标准 CSS Selector'}</p><div className="button-grid"><button className="secondary" onClick={() => void validateSelector()}>页面预览</button><button className="primary" onClick={() => void applySelector()}>使用此区域</button></div><button className="text-button" onClick={() => void saveRule()}>保存为本站规则</button></div> : null}
      </section> : null}
    </main>
  )
}
