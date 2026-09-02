import { z } from 'zod'
import type {
  LLMProvider,
  LLMRequest,
  LLMRequestOptions,
  LLMResponse,
  OpenAICompatibleConfig,
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

const responseSchema = z.object({
  choices: z.array(
    z.object({ message: z.object({ content: z.string() }) }),
  ).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
})

export function getOpenAIEndpoint(config: OpenAICompatibleConfig): string {
  if (config.endpoint) return config.endpoint
  return `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
}

export function usesMaxCompletionTokens(model: string): boolean {
  return /(?:^|\/)gpt-5(?:[.-]|$)/i.test(model)
}

export function mapOpenAIRequest(request: LLMRequest) {
  const modernTokenField = usesMaxCompletionTokens(request.model)
  return {
    model: request.model,
    messages: [
      ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
      ...request.messages,
    ],
    ...(!modernTokenField && request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.maxTokens !== undefined
      ? modernTokenField
        ? { max_completion_tokens: request.maxTokens }
        : { max_tokens: request.maxTokens }
      : {}),
    ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly config: OpenAICompatibleConfig

  constructor(config: OpenAICompatibleConfig) {
    this.config = config
  }

  async complete(request: LLMRequest, options?: LLMRequestOptions): Promise<LLMResponse> {
    const telemetry = prepareRequestTelemetry(options, this.config.timeoutMs)
    emitProviderTelemetry(telemetry, { type: 'request-started' })
    try {
      const response = await fetchWithRetry(
      getOpenAIEndpoint(this.config),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.config.customHeaders,
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(mapOpenAIRequest(request)),
      },
        telemetry.options,
      )
      const parsed = responseSchema.safeParse(await parseJsonResponse(response))
      if (!parsed.success) throw new ProviderError('OpenAI Compatible 响应格式不正确', 'invalid_response')
      const result: LLMResponse = {
      text: parsed.data.choices[0].message.content,
      usage: parsed.data.usage
        ? {
            inputTokens: parsed.data.usage.prompt_tokens,
            outputTokens: parsed.data.usage.completion_tokens,
            totalTokens: parsed.data.usage.total_tokens,
          }
        : undefined,
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
