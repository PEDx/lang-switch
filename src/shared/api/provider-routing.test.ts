import type { ProviderConfig, UserSettings } from '../types'
import { resolveTranslationProviders, uniqueTranslationProviders } from './provider-routing'

const providers: ProviderConfig[] = [
  { id: 'cheap', name: 'Cheap', type: 'openai-compatible', baseUrl: 'https://cheap.example/v1', apiKey: 'x', model: 'small' },
  { id: 'strong', name: 'Strong', type: 'anthropic', baseUrl: 'https://strong.example', apiKey: 'x', model: 'large' },
]

function settings(input: Partial<UserSettings>): UserSettings {
  return input as UserSettings
}

describe('translation Provider routing', () => {
  it('inherits the primary Provider for every stage by default', () => {
    const resolved = resolveTranslationProviders(providers, settings({ primaryProviderId: 'cheap' }))!
    expect(resolved.primary.id).toBe('cheap')
    expect([resolved.analysis, resolved.initial, resolved.review, resolved.refinement].map((item) => item.id))
      .toEqual(['cheap', 'cheap', 'cheap', 'cheap'])
  })

  it('supports stage overrides and falls back when an override was deleted', () => {
    const resolved = resolveTranslationProviders(providers, settings({
      primaryProviderId: 'cheap',
      translationStageProviderIds: { review: 'strong', refinement: 'deleted' },
    }))!
    expect(resolved.review.id).toBe('strong')
    expect(resolved.refinement.id).toBe('cheap')
    expect(uniqueTranslationProviders(resolved).map((item) => item.id)).toEqual(['cheap', 'strong'])
  })

  it('migrates legacy default selection and preserves a task preferred primary', () => {
    expect(resolveTranslationProviders(providers, settings({ defaultProviderId: 'strong' }))?.primary.id).toBe('strong')
    expect(resolveTranslationProviders(providers, settings({ primaryProviderId: 'cheap' }), 'strong')?.primary.id).toBe('strong')
  })
})
