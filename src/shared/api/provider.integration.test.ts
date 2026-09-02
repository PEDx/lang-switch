import { loadEnv } from 'vite'
import { OpenAICompatibleProvider } from './openai-compatible-provider'

const env = loadEnv('test', process.cwd(), '')

describe('configured OpenAI Compatible provider', () => {
  it('connects to the configured model and returns text', async () => {
    const baseUrl = env.AI_READER_PROVIDER_BASE_URL
    const apiKey = env.AI_READER_PROVIDER_API_KEY
    const model = env.AI_READER_PROVIDER_MODEL

    expect(baseUrl, 'AI_READER_PROVIDER_BASE_URL is missing').toBeTruthy()
    expect(apiKey, 'AI_READER_PROVIDER_API_KEY is missing').toBeTruthy()
    expect(model, 'AI_READER_PROVIDER_MODEL is missing').toBeTruthy()

    const provider = new OpenAICompatibleProvider({
      id: 'local-provider-test',
      name: 'Local provider integration test',
      type: 'openai-compatible',
      baseUrl,
      apiKey,
      model,
      timeoutMs: 45_000,
    })

    const result = await provider.testConnection()
    expect(result.ok).toBe(true)
  })
})
