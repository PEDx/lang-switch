import type { LLMProvider, ProviderConfig } from '../types'
import { providerConfigSchema } from '../schemas'
import { AnthropicProvider } from './anthropic-provider'
import { OpenAICompatibleProvider } from './openai-compatible-provider'
import { ProviderError } from './provider'

export function createProvider(rawConfig: ProviderConfig): LLMProvider {
  const parsed = providerConfigSchema.safeParse(rawConfig)
  if (!parsed.success) throw new ProviderError('Provider 配置不完整', 'configuration')
  switch (parsed.data.type) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(parsed.data)
    case 'anthropic':
      return new AnthropicProvider(parsed.data)
  }
}
