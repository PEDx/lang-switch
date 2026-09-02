import type { ProviderRequestTelemetryEvent } from '../types'
import { OpenAICompatibleProvider } from './openai-compatible-provider'

function successfulResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: 'OK' } }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function createProvider(): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'telemetry-test',
    name: 'Telemetry test',
    type: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
  })
}

describe('provider request telemetry', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports the complete request lifecycle with correlation and usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulResponse()))
    const events: ProviderRequestTelemetryEvent[] = []

    await createProvider().complete({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    }, {
      requestId: 'request-1',
      operation: 'initial-translation',
      maxRetries: 0,
      onTelemetry: (event) => events.push(event),
    })

    expect(events.map((event) => event.type)).toEqual([
      'request-started',
      'attempt-started',
      'response-received',
      'request-completed',
    ])
    expect(events.every((event) => event.requestId === 'request-1')).toBe(true)
    expect(events.every((event) => event.operation === 'initial-translation')).toBe(true)
    expect(events.at(-1)).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 15 })
  })

  it('exposes rate-limit retries and the next attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"busy"}}', {
        status: 429,
        headers: { 'retry-after': '0', 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(successfulResponse())
    vi.stubGlobal('fetch', fetchMock)
    const events: ProviderRequestTelemetryEvent[] = []

    await createProvider().complete({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    }, {
      maxRetries: 1,
      onTelemetry: (event) => events.push(event),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(events.find((event) => event.type === 'retry-scheduled')).toMatchObject({
      attempt: 1,
      status: 429,
      retryDelayMs: 0,
      errorCode: 'rate_limit',
    })
    expect(events.filter((event) => event.type === 'attempt-started').map((event) => event.attempt)).toEqual([1, 2])
    expect(events.at(-1)?.type).toBe('request-completed')
  })
})
