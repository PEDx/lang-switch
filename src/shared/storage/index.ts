import type {
  ProviderConfig,
  SiteRule,
  TranslationTaskState,
  UserSettings,
} from '../types'
import type { ExportTaskState } from '../export/export-types'

export const STORAGE_KEYS = {
  providers: 'ai-reader-providers',
  settings: 'ai-reader-settings',
  siteRules: 'ai-reader-site-rules',
  tasks: 'ai-reader-tasks',
  cache: 'ai-reader-cache-v1',
  diagnostics: 'ai-reader-diagnostics-v1',
  exportTasks: 'ai-reader-export-tasks-v1',
} as const

export const DEFAULT_SETTINGS: UserSettings = {
  defaultTargetLanguage: 'zh-CN',
  displayMode: 'bilingual',
  originalOpacity: 0.32,
  themeMode: 'system',
  translationDisplayStyle: 'highlight',
  translationLineHeight: null,
  translationFont: 'default',
  autoUseSiteRules: true,
  showSegmentToolbar: true,
  advancedMode: false,
  maxChunkTokens: 1800,
  maxConcurrency: 2,
  requestTimeoutMs: 60_000,
  terminology: '',
  customInstruction: '',
  cacheCapacity: 1_000,
}

function getStorage(): chrome.storage.StorageArea | undefined {
  return typeof chrome !== 'undefined' && chrome.storage?.local
    ? chrome.storage.local
    : undefined
}

export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const storage = getStorage()
  if (!storage) return fallback
  const result = await storage.get(key)
  return (result[key] as T | undefined) ?? fallback
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
  const storage = getStorage()
  if (!storage) return
  await storage.set({ [key]: value })
}

export async function getSettings(): Promise<UserSettings> {
  const stored = await storageGet<Partial<UserSettings>>(STORAGE_KEYS.settings, {})
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await storageSet(STORAGE_KEYS.settings, settings)
}

export async function getStorageUsage(): Promise<{ tasksBytes: number; cacheBytes: number; diagnosticsBytes: number; totalBytes: number }> {
  const storage = getStorage()
  if (!storage) return { tasksBytes: 0, cacheBytes: 0, diagnosticsBytes: 0, totalBytes: 0 }
  const values = await storage.get([STORAGE_KEYS.tasks, STORAGE_KEYS.cache, STORAGE_KEYS.diagnostics])
  const bytes = (value: unknown) => new Blob([JSON.stringify(value ?? null)]).size
  const tasksBytes = bytes(values[STORAGE_KEYS.tasks])
  const cacheBytes = bytes(values[STORAGE_KEYS.cache])
  const diagnosticsBytes = bytes(values[STORAGE_KEYS.diagnostics])
  return { tasksBytes, cacheBytes, diagnosticsBytes, totalBytes: tasksBytes + cacheBytes + diagnosticsBytes }
}

export const getProviders = () =>
  storageGet<ProviderConfig[]>(STORAGE_KEYS.providers, [])
export const saveProviders = (providers: ProviderConfig[]) =>
  storageSet(STORAGE_KEYS.providers, providers)
export const getSiteRules = () => storageGet<SiteRule[]>(STORAGE_KEYS.siteRules, [])
export const saveSiteRules = (rules: SiteRule[]) =>
  storageSet(STORAGE_KEYS.siteRules, rules)
export const getTasks = () =>
  storageGet<Record<string, TranslationTaskState>>(STORAGE_KEYS.tasks, {})
export const saveTasks = (tasks: Record<string, TranslationTaskState>) =>
  storageSet(STORAGE_KEYS.tasks, tasks)
export const getExportTasks = () =>
  storageGet<Record<string, ExportTaskState>>(STORAGE_KEYS.exportTasks, {})
export const saveExportTasks = (tasks: Record<string, ExportTaskState>) =>
  storageSet(STORAGE_KEYS.exportTasks, tasks)
