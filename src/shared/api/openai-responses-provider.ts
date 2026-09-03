import { z } from 'zod'
import type {
  LLMProvider,
  LLMRequest,
  LLMRequestOptions,
  LLMResponse,
  OpenAIResponsesConfig,
  ProviderTestResult,
} from '../types'
import {
  emitProviderTelemetry,
  fetchWithRetry,
  makeTestResult,
  parseJsonResponse,
  prepareRequestTelemetry,
  ProviderError,
} from './provider'
import { usesMaxCompletionTokens } from './openai-compatible-provider'

const responseSchema = z.object({
  output: z.array(z.object({
    type: z.string().optional(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
}).passthrough()

export function getOpenAIResponsesEndpoint(config: OpenAIResponsesConfig): string {
  if (config.endpoint) return config.endpoint
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  if (/\/responses$/i.test(baseUrl)) return baseUrl
  if (/\/v\d+(?:beta\d*)?$/i.test(baseUrl)) return `${baseUrl}/responses`
  return `${baseUrl}/v1/responses`
}

export function mapOpenAIResponsesRequest(request: LLMRequest) {
  return {
    model: request.model,
    ...(request.system ? { instructions: request.system } : {}),
    input: request.messages,
    store: false,
    ...(!usesMaxCompletionTokens(request.model) && request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.maxTokens !== undefined ? { max_output_tokens: request.maxTokens } : {}),
    ...(request.responseFormat === 'json'
      ? { text: { format: { type: 'json_object' as const } } }
      : {}),
  }
}

export function extractOpenAIResponsesText(
  output: Array<{ content?: Array<{ type: string; text?: string }> }>,
): string {
  return output
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text!)
    .join('')
}

export class OpenAIResponsesProvider implements LLMProvider {
  private readonly config: OpenAIResponsesConfig

  constructor(config: OpenAIResponsesConfig) {
    this.config = config
  }

  async complete(request: LLMRequest, options?: LLMRequestOptions): Promise<LLMResponse> {
    const telemetry = prepareRequestTelemetry(options, this.config.timeoutMs)
    emitProviderTelemetry(telemetry, { type: 'request-started' })
    try {
      const response = await fetchWithRetry(
        getOpenAIResponsesEndpoint(this.config),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...this.config.customHeaders,
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(mapOpenAIResponsesRequest(request)),
        },
        telemetry.options,
      )
      const raw = await parseJsonResponse(response)
      const parsed = responseSchema.safeParse(raw)
      if (!parsed.success) throw new ProviderError('OpenAI Responses 响应格式不正确', 'invalid_response')
      const text = extractOpenAIResponsesText(parsed.data.output)
      if (!text) throw new ProviderError('OpenAI Responses 未返回 output_text', 'invalid_response')
      const result: LLMResponse = {
        text,
        usage: parsed.data.usage
          ? {
              inputTokens: parsed.data.usage.input_tokens,
              outputTokens: parsed.data.usage.output_tokens,
              totalTokens: parsed.data.usage.total_tokens,
            }
          : undefined,
        raw,
      }
      emitProviderTelemetry(telemetry, { type: 'request-completed', ...result.usage })
      return result
    } catch (error) {
      const providerError = error as { code?: string; status?: number }
      emitProviderTelemetry(telemetry, {
        type: 'request-failed', errorCode: providerError.code, status: providerError.status,
      })
      throw error
    }
  }

  async testConnection(): Promise<ProviderTestResult> {
    const startedAt = performance.now()
    const response = await this.complete({
      model: this.config.model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxTokens: usesMaxCompletionTokens(this.config.model) ? 128 : 8,
      temperature: 0,
    })
    return makeTestResult(startedAt, response)
  }
}
