import { useEffect, useState } from 'react'
import type { ProviderConfig, UserSettings } from '../shared/types'
import {
  DEFAULT_SETTINGS,
  getProviders,
  getSettings,
  saveProviders,
  saveSettings,
} from '../shared/storage'
import { ensureProviderHostPermission } from '../shared/api/provider-permissions'
import { createEmptyProvider } from './provider-defaults'

function ProviderEditor({ value, onChange, onSave, onDelete }: { value: ProviderConfig; onChange: (value: ProviderConfig) => void; onSave: () => Promise<void>; onDelete: () => void }) {
  const [advanced, setAdvanced] = useState(false)
  const [headers, setHeaders] = useState(() => JSON.stringify(value.customHeaders ?? {}, null, 2))
  const [message, setMessage] = useState('')
  const update = (patch: Partial<ProviderConfig>) => onChange({ ...value, ...patch } as ProviderConfig)
  const changeType = (type: ProviderConfig['type']) => {
    const next = createEmptyProvider(type)
    onChange({ ...next, id: value.id, name: value.name, apiKey: value.apiKey })
  }
  const test = async () => {
    setMessage('正在测试连接…')
    try {
      if (!await ensureProviderHostPermission(value)) throw new Error('未授予模型服务域名访问权限')
      await onSave()
      const response = await chrome.runtime.sendMessage({ type: 'TEST_PROVIDER', providerId: value.id })
      setMessage(response?.ok ? `${response.result.message} · ${response.result.latencyMs} ms` : response?.error || '连接失败')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败')
    }
  }
  const applyHeaders = (text: string) => {
    setHeaders(text)
    try {
      const parsed = JSON.parse(text) as Record<string, string>
      update({ customHeaders: parsed })
      setMessage('')
    } catch {
      setMessage('自定义 Header 必须是 JSON 对象')
    }
  }
  return (
    <section className="card provider-editor">
      <div className="section-head"><div><span className="eyebrow">Provider</span><h2>{value.name || '未命名配置'}</h2></div><button className="delete" onClick={onDelete}>删除</button></div>
      <fieldset><legend>API 类型</legend><label className="radio"><input type="radio" checked={value.type === 'anthropic'} onChange={() => changeType('anthropic')} /> Anthropic Messages</label><label className="radio"><input type="radio" checked={value.type === 'openai-compatible'} onChange={() => changeType('openai-compatible')} /> OpenAI Compatible</label></fieldset>
      <div className="form-grid">
        <label>配置名称<input value={value.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <label>Base URL<input type="url" value={value.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} /></label>
        <label>API Key<input type="password" autoComplete="off" value={value.apiKey} onChange={(event) => update({ apiKey: event.target.value })} /></label>
        <label>Model<input value={value.model} onChange={(event) => update({ model: event.target.value })} placeholder="model-name" /></label>
      </div>
      <button className="disclosure" onClick={() => setAdvanced(!advanced)}>高级选项 <span>{advanced ? '−' : '+'}</span></button>
      {advanced ? <div className="form-grid advanced"><label>完整 Endpoint（可选）<input type="url" value={value.endpoint ?? ''} onChange={(event) => update({ endpoint: event.target.value })} /></label>{value.type === 'anthropic' ? <label>Anthropic Version<input value={value.anthropicVersion ?? ''} onChange={(event) => update({ anthropicVersion: event.target.value } as Partial<ProviderConfig>)} /></label> : null}<label>Temperature<input type="number" min="0" max="2" step="0.1" value={value.temperature ?? .2} onChange={(event) => update({ temperature: Number(event.target.value) })} /></label><label>最大输出 Token<input type="number" min="1" value={value.maxTokens ?? 4096} onChange={(event) => update({ maxTokens: Number(event.target.value) })} /></label><label>请求超时（ms）<input type="number" min="1000" value={value.timeoutMs ?? 60000} onChange={(event) => update({ timeoutMs: Number(event.target.value) })} /></label><label>最大并发数<input type="number" min="1" max="8" value={value.maxConcurrency ?? 2} onChange={(event) => update({ maxConcurrency: Number(event.target.value) })} /></label><label className="full">自定义 Headers（JSON）<textarea rows={5} value={headers} onChange={(event) => applyHeaders(event.target.value)} /></label></div> : null}
      {message ? <p className={message.includes('成功') ? 'success' : 'message'}>{message}</p> : null}
      <div className="actions"><button className="secondary" onClick={() => void test()}>测试连接</button><button className="primary" onClick={() => void onSave()}>保存</button></div>
    </section>
  )
}

export function App() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState('')
  useEffect(() => { void Promise.all([getProviders(), getSettings()]).then(([items, stored]) => { setProviders(items); setSettings(stored); setSelectedId(items[0]?.id ?? '') }) }, [])
  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.themeMode
  }, [settings])
  const selected = providers.find((provider) => provider.id === selectedId)
  const updateSelected = (provider: ProviderConfig) => setProviders((items) => items.map((item) => item.id === provider.id ? provider : item))
  const persist = async () => { await Promise.all([saveProviders(providers), saveSettings(settings)]); setSaved('设置已保存'); window.setTimeout(() => setSaved(''), 1800) }
  const addProvider = () => { const next = createEmptyProvider(); setProviders((items) => [...items, next]); setSelectedId(next.id) }
  const removeProvider = () => { if (!selected) return; const next = providers.filter((item) => item.id !== selected.id); setProviders(next); setSelectedId(next[0]?.id ?? ''); if (settings.defaultProviderId === selected.id) setSettings({ ...settings, defaultProviderId: next[0]?.id }) }
  return (
    <main className="options-shell">
      <header><div className="options-brand"><img className="options-logo" src="/brand/lang-switch-mark.png" alt="" /><div><span className="eyebrow">Lang Switch</span><h1>Lang Switch 设置</h1><p>模型凭证与长文阅读偏好只保存在本地扩展存储中。</p></div></div><button className="primary" onClick={() => void persist()}>保存全部</button></header>
      {saved ? <div className="toast">{saved}</div> : null}
      <div className="layout"><nav className="sidebar"><button className="add" onClick={addProvider}>＋ 新建 Provider</button>{providers.map((provider) => <button key={provider.id} className={provider.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(provider.id)}><span>{provider.type === 'anthropic' ? 'A' : 'O'}</span><div>{provider.name}<small>{provider.model || '尚未设置模型'}</small></div></button>)}</nav><div>
        {selected ? <ProviderEditor value={selected} onChange={updateSelected} onSave={persist} onDelete={removeProvider} /> : <section className="card empty"><h2>还没有 Provider</h2><p>创建一个 OpenAI Compatible 或 Anthropic 配置后即可开始精译。</p><button className="primary" onClick={addProvider}>新建 Provider</button></section>}
        <section className="card"><span className="eyebrow">基础设置</span><h2>阅读偏好</h2><div className="form-grid"><label>默认 Provider<select value={settings.defaultProviderId ?? ''} onChange={(event) => setSettings({ ...settings, defaultProviderId: event.target.value })}><option value="">自动选择第一个</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label>默认目标语言<select value={settings.defaultTargetLanguage} onChange={(event) => setSettings({ ...settings, defaultTargetLanguage: event.target.value })}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="en">English</option></select></label><label>原文透明度<input type="range" min="10" max="100" value={settings.originalOpacity * 100} onChange={(event) => setSettings({ ...settings, originalOpacity: Number(event.target.value) / 100 })} /></label><label className="check"><input type="checkbox" checked={settings.autoUseSiteRules} onChange={(event) => setSettings({ ...settings, autoUseSiteRules: event.target.checked })} /> 自动使用站点规则</label><label className="check"><input type="checkbox" checked={settings.showSegmentToolbar} onChange={(event) => setSettings({ ...settings, showSegmentToolbar: event.target.checked })} /> 显示单段工具栏</label></div></section>
        <section className="card"><span className="eyebrow">高级设置</span><h2>精译 Pipeline</h2><div className="form-grid"><label>分块最大 Token<input type="number" min="200" value={settings.maxChunkTokens} onChange={(event) => setSettings({ ...settings, maxChunkTokens: Number(event.target.value) })} /></label><label>最大并发数<input type="number" min="1" max="8" value={settings.maxConcurrency} onChange={(event) => setSettings({ ...settings, maxConcurrency: Number(event.target.value) })} /></label><label>请求超时（ms）<input type="number" min="1000" value={settings.requestTimeoutMs} onChange={(event) => setSettings({ ...settings, requestTimeoutMs: Number(event.target.value) })} /></label><label>缓存容量（段落）<input type="number" min="10" value={settings.cacheCapacity} onChange={(event) => setSettings({ ...settings, cacheCapacity: Number(event.target.value) })} /></label><label className="full">自定义术语表<textarea rows={5} value={settings.terminology} onChange={(event) => setSettings({ ...settings, terminology: event.target.value })} placeholder="React = React（保留原文）" /></label><label className="full">自定义翻译要求<textarea rows={4} value={settings.customInstruction} onChange={(event) => setSettings({ ...settings, customInstruction: event.target.value })} /></label></div></section>
      </div></div>
    </main>
  )
}
