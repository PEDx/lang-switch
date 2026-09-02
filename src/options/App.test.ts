import { createEmptyProvider } from './provider-defaults'

describe('Provider defaults', () => {
  it('creates Anthropic Messages providers by default', () => {
    const provider = createEmptyProvider()

    expect(provider).toMatchObject({
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      anthropicVersion: '2023-06-01',
    })
  })

  it('still supports explicitly creating an OpenAI-compatible provider', () => {
    expect(createEmptyProvider('openai-compatible')).toMatchObject({
      type: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
    })
  })
})
