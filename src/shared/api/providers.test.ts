import { AnthropicProvider, extractAnthropicText, getAnthropicEndpoint, mapAnthropicRequest } from './anthropic-provider'
import { createProvider } from './provider-factory'
import { getOpenAIEndpoint, mapOpenAIRequest, OpenAICompatibleProvider, usesMaxCompletionTokens } from './openai-compatible-provider'
import {
  extractOpenAIResponsesText,
  getOpenAIResponsesEndpoint,
  mapOpenAIResponsesRequest,
  OpenAIResponsesProvider,
} from './openai-responses-provider'

describe('provider request mapping', () => {
  it('maps OpenAI system messages and JSON response format', () => {
    const body = mapOpenAIRequest({
      model: 'gpt-test', system: 'system', messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 99, temperature: 0.2, responseFormat: 'json',
    })
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system' })
    expect(body).toMatchObject({ max_tokens: 99, response_format: { type: 'json_object' } })
    expect(getOpenAIEndpoint({ id: '1', name: 'x', type: 'openai-compatible', baseUrl: 'https://api.example.com/v1/', apiKey: 'secret', model: 'm' })).toBe('https://api.example.com/v1/chat/completions')
  })

  it('uses max_completion_tokens for GPT-5 compatible models', () => {
    const body = mapOpenAIRequest({
      model: 'external/gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 128,
      temperature: 0.2,
    })
    expect(usesMaxCompletionTokens('external/gpt-5.5')).toBe(true)
    expect(body).toMatchObject({ max_completion_tokens: 128 })
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
  })

  it('maps native OpenAI Responses requests and endpoints', () => {
    const body = mapOpenAIResponsesRequest({
      model: 'gpt-test', system: 'system', messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 99, temperature: 0.2, responseFormat: 'json',
    })
    expect(body).toMatchObject({
      model: 'gpt-test', instructions: 'system', input: [{ role: 'user', content: 'hello' }],
      store: false, max_output_tokens: 99, temperature: 0.2,
      text: { format: { type: 'json_object' } },
    })
    expect(getOpenAIResponsesEndpoint({ id: '1', name: 'x', type: 'openai-responses', baseUrl: 'https://api.openai.com/v1/', apiKey: 'secret', model: 'm' }))
      .toBe('https://api.openai.com/v1/responses')
    expect(getOpenAIResponsesEndpoint({ id: '1', name: 'x', type: 'openai-responses', baseUrl: 'https://api.openai.com', apiKey: 'secret', model: 'm' }))
      .toBe('https://api.openai.com/v1/responses')
  })

  it('extracts output_text blocks from native Responses output', () => {
    expect(extractOpenAIResponsesText([
      { content: [{ type: 'reasoning', text: 'hidden' }] },
      { content: [{ type: 'output_text', text: 'Hello ' }, { type: 'output_text', text: 'world' }] },
    ])).toBe('Hello world')
  })

  it('maps Anthropic system and max_tokens at the top level', () => {
    const body = mapAnthropicRequest({
      model: 'claude-test', system: 'system', messages: [{ role: 'user', content: 'hello' }], maxTokens: 321,
    })
    expect(body).toEqual({ model: 'claude-test', system: 'system', messages: [{ role: 'user', content: 'hello' }], max_tokens: 321 })
    expect(getAnthropicEndpoint({ id: '1', name: 'x', type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'secret', model: 'm' })).toBe('https://api.anthropic.com/v1/messages')
  })

  it('extracts only Anthropic text blocks', () => {
    expect(extractAnthropicText([{ type: 'thinking', text: 'hidden' }, { type: 'text', text: 'Hello ' }, { type: 'tool_use' }, { type: 'text', text: 'world' }])).toBe('Hello world')
  })

  it('creates the correct provider implementation', () => {
    expect(createProvider({ id: '1', name: 'OpenAI', type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' })).toBeInstanceOf(OpenAICompatibleProvider)
    expect(createProvider({ id: '2', name: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'key', model: 'm' })).toBeInstanceOf(AnthropicProvider)
    expect(createProvider({ id: '3', name: 'Responses', type: 'openai-responses', baseUrl: 'https://api.openai.com/v1', apiKey: 'key', model: 'm' })).toBeInstanceOf(OpenAIResponsesProvider)
  })
})
