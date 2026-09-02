import { useEffect, useState } from 'react'
import type { DiagnosticLogEntry, DisplayMode, TranslationTaskState } from '../../shared/types'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'paused'])
const OPERATION_LABELS: Record<string, string> = {
  'article-analysis': '全文分析',
  'article-analysis:json-repair': '全文分析格式修复',
  'initial-translation': '初始翻译',
  'initial-translation:json-repair': '初译格式修复',
  'translation-review': '翻译审阅',
  'translation-review:json-repair': '审阅格式修复',
  'final-refinement': '最终润色',
  'final-refinement:json-repair': '润色格式修复',
}

const PIPELINE_STAGES = ['全文分析', '初始翻译', '翻译审阅', '最终润色', '页面回写'] as const

const DETAIL_LABELS: Record<string, string> = {
  attempt: '尝试',
  maxAttempts: '最多尝试',
  timeoutMs: '超时',
  elapsedMs: '耗时',
  attemptElapsedMs: '本次耗时',
  httpStatus: 'HTTP',
  retryDelayMs: '退避',
  errorCode: '错误码',
  inputTokens: '输入 Token',
  outputTokens: '输出 Token',
  totalTokens: '总 Token',
  chunkId: 'Chunk',
  segmentCount: '段落',
  durationMs: '耗时',
  cacheHits: '缓存命中',
  cacheMisses: '缓存未命中',
  translatedCount: '译文数',
  renderedCount: '已挂载',
  attachedCount: '仍在 DOM',
  visibleCount: '肉眼可见',
  renderFailureCount: '挂载失败',
  hiddenCount: '被隐藏',
  displayMode: '显示方式',
}

function useMonitorClock(active: boolean, initialNow: number): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])
  return now || initialNow
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return '—'
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`
  const seconds = Math.round(milliseconds / 1_000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes} 分 ${remaining} 秒`
}

function formatDetails(details?: DiagnosticLogEntry['details']): string {
  if (!details) return ''
  return Object.entries(details)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => {
      const label = DETAIL_LABELS[key] ?? key
      const formatted = key.toLowerCase().endsWith('ms') && typeof value === 'number'
        ? formatDuration(value)
        : String(value)
      return `${label}=${formatted}`
    })
    .join(' · ')
}

function taskTitle(status: TranslationTaskState['status']): string {
  if (status === 'completed') return '精译完成'
  if (status === 'paused') return '精译已暂停'
  if (status === 'cancelled') return '精译已停止'
  if (status === 'failed') return '精译失败'
  return '正在精译'
}

function currentPipelineStage(task: TranslationTaskState): number {
  if (task.status === 'completed') return PIPELINE_STAGES.length
  const failedDuringRender = task.chunkProgress?.some((chunk) =>
    chunk.status === 'failed' && chunk.error?.includes('页面'),
  )
  if (failedDuringRender) return 4
  if (task.status === 'analyzing' || task.currentStage?.includes('分析')) return 0
  if (task.status === 'reviewing' || task.currentStage?.includes('审阅')) return 2
  if (task.status === 'refining' || task.currentStage?.includes('润色')) return 3
  if (task.status === 'translating' || task.currentStage?.includes('初始翻译')) return 1
  return task.currentChunkIndex ? 1 : 0
}

function healthState(task: TranslationTaskState, now: number) {
  const active = task.telemetry?.activeRequest
  if (task.status === 'failed') return { className: 'danger', label: '任务失败' }
  if (task.status === 'completed') return { className: 'healthy', label: '已完成' }
  if (task.status === 'paused') return { className: 'neutral', label: '已暂停' }
  if (task.status === 'cancelled') return { className: 'neutral', label: '已停止' }
  if (active?.state === 'backoff') return { className: 'warning', label: '等待重试' }
  if (active?.state === 'processing') return { className: 'healthy', label: '校验响应' }
  if (active) {
    const elapsed = now - (active.attemptStartedAt ?? active.startedAt)
    if (elapsed >= active.timeoutMs * 0.85) return { className: 'danger', label: '接近超时' }
    if (elapsed >= 15_000) return { className: 'warning', label: '响应较慢' }
    return { className: 'healthy', label: '请求进行中' }
  }
  const inactiveFor = now - (task.telemetry?.lastActivityAt ?? task.updatedAt)
  return inactiveFor > 20_000
    ? { className: 'warning', label: '等待后续处理' }
    : { className: 'healthy', label: '运行正常' }
}

function RequestStatus({ task, now }: { task: TranslationTaskState; now: number }) {
  const request = task.telemetry?.activeRequest
  if (!request) return <p className="monitor-idle">当前没有进行中的模型请求</p>
  const elapsed = now - request.startedAt
  const attemptElapsed = now - (request.attemptStartedAt ?? request.startedAt)
  const backoffRemaining = request.retryAt ? Math.max(0, request.retryAt - now) : 0
  return (
    <div className="active-request">
      <div><strong>{OPERATION_LABELS[request.operation] ?? request.operation}</strong><code>{request.requestId.slice(0, 8)}</code></div>
      <p>{request.state === 'backoff'
        ? `第 ${request.attempt} 次请求失败，${formatDuration(backoffRemaining)}后进行下一次尝试`
        : request.state === 'processing'
          ? `模型已返回 HTTP ${request.lastHttpStatus ?? '响应'}，正在解析并校验结果`
        : `第 ${request.attempt} / ${request.maxAttempts} 次尝试 · 本次已等待 ${formatDuration(attemptElapsed)}`}</p>
      <div className="request-timebar"><span style={{ width: `${Math.min(100, (attemptElapsed / request.timeoutMs) * 100)}%` }} /></div>
      <small>请求累计 {formatDuration(elapsed)} · 单次超时 {formatDuration(request.timeoutMs)}{request.lastHttpStatus ? ` · HTTP ${request.lastHttpStatus}` : ''}</small>
    </div>
  )
}

export function TranslationMonitor({
  task,
  logs,
  displayMode,
  onClear,
}: {
  task: TranslationTaskState
  logs: DiagnosticLogEntry[]
  displayMode?: DisplayMode
  onClear: () => void
}) {
  const running = !TERMINAL_STATUSES.has(task.status)
  const now = useMonitorClock(running, task.updatedAt)
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all')
  const [scope, setScope] = useState<'all' | DiagnosticLogEntry['scope']>('all')
  const telemetry = task.telemetry
  const completedOrFailed = task.completedSegments + task.failedSegments
  const progress = task.totalSegments ? (completedOrFailed / task.totalSegments) * 100 : 0
  const finishedRequests = (telemetry?.completedRequests ?? 0) + (telemetry?.failedRequests ?? 0)
  const averageLatency = finishedRequests ? (telemetry?.totalLatencyMs ?? 0) / finishedRequests : undefined
  const successRate = finishedRequests ? ((telemetry?.completedRequests ?? 0) / finishedRequests) * 100 : undefined
  const health = healthState(task, now)
  const pipelineStage = currentPipelineStage(task)
  const taskLogs = logs.filter((entry) =>
    entry.taskId === task.taskId || (!entry.taskId && entry.timestamp >= task.createdAt - 2_000),
  )
  const visibleLogs = taskLogs
    .filter((entry) => level === 'all' || entry.level === level)
    .filter((entry) => scope === 'all' || entry.scope === scope)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 250)
  const copy = async () => {
    const summary = [
      `任务=${task.status}`,
      `进度=${task.completedSegments}/${task.totalSegments}`,
      `Chunk=${task.currentChunkIndex ?? 0}/${task.totalChunks ?? 0}`,
      `请求=${telemetry?.completedRequests ?? 0}/${telemetry?.totalRequests ?? 0}`,
      `失败=${telemetry?.failedRequests ?? 0}`,
      `重试=${telemetry?.retryCount ?? 0}`,
      `显示=${displayMode ?? task.displayMode}`,
      `平均延迟=${formatDuration(averageLatency)}`,
    ].join(' · ')
    const logText = visibleLogs.map((entry) =>
      `${new Date(entry.timestamp).toISOString()} [${entry.level}] [${entry.scope}]${entry.operation ? ` [${entry.operation}]` : ''}${entry.requestId ? ` [${entry.requestId.slice(0, 8)}]` : ''} ${entry.message}${entry.details ? ` | ${formatDetails(entry.details)}` : ''}`,
    ).join('\n')
    await navigator.clipboard.writeText(`${summary}\n${logText}`)
  }

  return (
    <section className="card monitor-card" aria-live="polite">
      <div className="monitor-heading"><div><div className="eyebrow">运行中心</div><h2>{taskTitle(task.status)}</h2></div><span className={`health-badge ${health.className}`}>{health.label}</span></div>
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      <div className="progress-copy"><strong>{task.completedSegments}</strong> / {task.totalSegments} 个段落 <span>{Math.round(progress)}%</span></div>
      <div className="stage-timeline" aria-label="当前 Chunk 翻译阶段">
        <div className="stage-timeline-title">当前 Chunk 流程</div>
        <ol>{PIPELINE_STAGES.map((stage, index) => <li key={stage} className={pipelineStage > index ? 'completed' : pipelineStage === index ? 'active' : 'pending'}><span className="stage-dot" /><span>{stage}</span></li>)}</ol>
      </div>
      <dl className="monitor-grid">
        <div><dt>当前阶段</dt><dd>{task.currentStage || '准备翻译'}</dd></div>
        <div><dt>Chunk</dt><dd>{task.currentChunkIndex ?? 0} / {task.totalChunks ?? task.pendingChunkIds.length}</dd></div>
        <div><dt>阶段耗时</dt><dd>{formatDuration(now - (telemetry?.stageStartedAt ?? task.updatedAt))}</dd></div>
        <div><dt>预计剩余</dt><dd>{formatDuration(telemetry?.estimatedRemainingMs)}</dd></div>
        <div><dt>请求成功率</dt><dd>{successRate === undefined ? '—' : `${Math.round(successRate)}%`}</dd></div>
        <div><dt>平均延迟</dt><dd>{formatDuration(averageLatency)}</dd></div>
        <div><dt>当前模型</dt><dd title={task.model}>{task.model || '—'}</dd></div>
        <div><dt>Provider</dt><dd title={task.providerName}>{task.providerName || task.providerType || task.providerId}</dd></div>
        <div><dt>显示方式</dt><dd>{(displayMode ?? task.displayMode) === 'bilingual' ? '双语' : (displayMode ?? task.displayMode) === 'translation' ? '仅译文' : '仅原文'}</dd></div>
        <div><dt>重试 / 请求失败</dt><dd>{telemetry?.retryCount ?? 0} / {telemetry?.failedRequests ?? 0}</dd></div>
        <div><dt>Token</dt><dd>{telemetry?.totalTokens ? telemetry.totalTokens.toLocaleString() : '服务未返回'}</dd></div>
      </dl>
      <RequestStatus task={task} now={now} />
      {(displayMode ?? task.displayMode) === 'original' && (task.translations?.length ?? 0) > 0 ? <p className="monitor-notice">当前是“仅原文”模式，已生成的译文被隐藏。请在下方“阅读显示”切换为“双语”或“仅译文”。</p> : null}
      {task.currentSection ? <p className="current-section">当前章节：{task.currentSection}</p> : null}
      {task.failedSegments > 0 ? <p className="error">{task.failedSegments} 个段落失败，已完成内容仍保留。</p> : null}
      {task.error ? <p className="error">{task.error}</p> : null}
      <div className="chunk-rail" aria-label="Chunk 进度">
        {task.chunkProgress?.map((chunk) => <span key={chunk.chunkId} className={chunk.status} title={`${chunk.chunkId} · ${chunk.status}${chunk.durationMs ? ` · ${formatDuration(chunk.durationMs)}` : ''}`} />)}
      </div>
      <details className="monitor-logs">
        <summary><span>集中日志</span><span>{taskLogs.length}</span></summary>
        <div className="log-toolbar">
          <select aria-label="日志级别" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}><option value="all">全部级别</option><option value="warn">仅警告</option><option value="error">仅错误</option></select>
          <select aria-label="日志模块" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="all">全部模块</option><option value="provider">模型接口</option><option value="pipeline">翻译流程</option><option value="render">页面回写</option><option value="task">任务</option><option value="lifecycle">生命周期</option></select>
          <button className="text-button" onClick={() => void copy()}>复制诊断</button><button className="text-button" onClick={onClear}>清空</button>
        </div>
        {visibleLogs.length > 0 ? <ol className="log-list">{visibleLogs.map((entry) => <li key={entry.id} className={`log-${entry.level}`}><time>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</time><div><strong>{entry.message}</strong><span className="log-context">{entry.operation ? OPERATION_LABELS[entry.operation] ?? entry.operation : entry.scope}{entry.requestId ? ` · ${entry.requestId.slice(0, 8)}` : ''}</span>{entry.details ? <small>{formatDetails(entry.details)}</small> : null}</div></li>)}</ol> : <p className="hint log-empty">当前筛选条件下没有日志</p>}
      </details>
    </section>
  )
}
