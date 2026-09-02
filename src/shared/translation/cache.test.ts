import { createCacheKey, stableHash } from './cache'

describe('translation cache key', () => {
  const base = {
    sourceText: 'Original', sourceLanguage: 'en', targetLanguage: 'zh-CN',
    providerType: 'anthropic', model: 'model-a', translationMode: 'precision',
    articleContextHash: 'context-a', terminologyHash: 'terms-a', customInstructionHash: 'custom-a',
  }

  it('is stable for equivalent objects', () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }))
    expect(createCacheKey(base)).toBe(createCacheKey({ ...base }))
    expect(createCacheKey(base)).toMatch(/^v2:/)
  })

  it('changes when model, context, terminology, or instruction changes', () => {
    const original = createCacheKey(base)
    expect(createCacheKey({ ...base, model: 'model-b' })).not.toBe(original)
    expect(createCacheKey({ ...base, articleContextHash: 'context-b' })).not.toBe(original)
    expect(createCacheKey({ ...base, terminologyHash: 'terms-b' })).not.toBe(original)
    expect(createCacheKey({ ...base, customInstructionHash: 'custom-b' })).not.toBe(original)
    expect(createCacheKey({ ...base, continuityHash: 'previous-final-b' })).not.toBe(original)
  })
})
