import { STORAGE_KEYS, storageGet, storageSet } from '../storage'
import type { SegmentTranslation } from '../types'

const CACHE_VERSION = 2
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface TranslationCacheKeyInput {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  providerType: string
  model: string
  translationMode: string
  articleContextHash: string
  terminologyHash: string
  customInstructionHash: string
  continuityHash?: string
}

interface CacheEntry {
  key: string
  value: SegmentTranslation
  createdAt: number
  accessedAt: number
  version: number
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

export function stableHash(value: unknown): string {
  const text = stableSerialize(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createCacheKey(input: TranslationCacheKeyInput): string {
  return `v${CACHE_VERSION}:${stableHash(input)}`
}

export class TranslationCache {
  private readonly capacity: number
  private readonly ttlMs: number

  constructor(
    capacity = 1_000,
    ttlMs = DEFAULT_TTL_MS,
  ) {
    this.capacity = capacity
    this.ttlMs = ttlMs
  }

  private async read(): Promise<Record<string, CacheEntry>> {
    return storageGet<Record<string, CacheEntry>>(STORAGE_KEYS.cache, {})
  }

  async get(key: string): Promise<SegmentTranslation | null> {
    const entries = await this.read()
    const entry = entries[key]
    if (!entry || entry.version !== CACHE_VERSION || Date.now() - entry.createdAt > this.ttlMs) {
      if (entry) {
        delete entries[key]
        await storageSet(STORAGE_KEYS.cache, entries)
      }
      return null
    }
    entry.accessedAt = Date.now()
    await storageSet(STORAGE_KEYS.cache, entries)
    return entry.value
  }

  async set(key: string, value: SegmentTranslation): Promise<void> {
    const entries = await this.read()
    const now = Date.now()
    for (const [entryKey, entry] of Object.entries(entries)) {
      if (entry.version !== CACHE_VERSION || now - entry.createdAt > this.ttlMs) delete entries[entryKey]
    }
    entries[key] = { key, value, version: CACHE_VERSION, createdAt: now, accessedAt: now }
    const ordered = Object.values(entries).sort((a, b) => b.accessedAt - a.accessedAt)
    const pruned = Object.fromEntries(ordered.slice(0, Math.max(1, this.capacity)).map((entry) => [entry.key, entry]))
    await storageSet(STORAGE_KEYS.cache, pruned)
  }

  async clear(): Promise<void> {
    await storageSet(STORAGE_KEYS.cache, {})
  }
}
