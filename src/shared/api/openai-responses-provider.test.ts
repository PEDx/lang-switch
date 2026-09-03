import type { ProviderRequestTelemetryEvent } from '../types'
import { OpenAIResponsesProvider } from './openai-responses-provider'

describe('OpenAI Responses Provider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses output text and native usage telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
      usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const events: ProviderRequestTelemetryEvent[] = []
    const provider = new OpenAIResponsesProvider({
      id: 'responses', name: 'Responses', type: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1', apiKey: 'test', model: 'gpt-test',
    })

    const response = await provider.complete({
      model: 'gpt-test', messages: [{ role: 'user', content: 'json' }], responseFormat: 'json',
    }, { maxRetries: 0, onTelemetry: (event) => events.push(event) })

    expect(response.text).toBe('{"ok":true}')
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 4, totalTokens: 15 })
    expect(events.at(-1)).toMatchObject({
      type: 'request-completed', inputTokens: 11, outputTokens: 4, totalTokens: 15,
    })
  })
})
