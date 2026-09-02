import type { ProviderConfig } from '../shared/types'

export function createEmptyProvider(type: ProviderConfig['type'] = 'anthropic'): ProviderConfig {
  const common = {
    id: crypto.randomUUID(),
    name: '我的翻译模型',
    apiKey: '',
    model: '',
    baseUrl: type === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs: 60_000,
    maxConcurrency: 2,
  }
  return type === 'anthropic'
    ? { ...common, type, anthropicVersion: '2023-06-01' }
    : { ...common, type }
}
