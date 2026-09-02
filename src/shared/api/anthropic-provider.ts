import { z } from 'zod'
import type {
  AnthropicConfig,
  LLMProvider,
  LLMRequest,
  LLMRequestOptions,
  LLMResponse,
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

const anthropicResponseSchema = z.object({
  content: z.array(z.object({
    type: z.string(),
    text: z.string().nullable().optional(),
  })),
  stop_reason: z.string().nullable().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
})

export function getAnthropicEndpoint(config: AnthropicConfig): string {
  if (config.endpoint) return config.endpoint
  const base = config.baseUrl.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
}

export function mapAnthropicRequest(request: LLMRequest) {
  return {
    model: request.model,
    ...(request.system ? { system: request.system } : {}),
    messages: request.messages,
    max_tokens: request.maxTokens ?? 2048,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
  }
}

export function extractAnthropicText(content: Array<{ type: string; text?: string | null }>): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string' && block.text.length > 0)
    .map((block) => block.text as string)
    .join('')
}

export class AnthropicProvider implements LLMProvider {
  private readonly config: AnthropicConfig

  constructor(config: AnthropicConfig) {
    this.config = config
  }

  async complete(request: LLMRequest, options?: LLMRequestOptions): Promise<LLMResponse> {
    const telemetry = prepareRequestTelemetry(options, this.config.timeoutMs)
    emitProviderTelemetry(telemetry, { type: 'request-started' })
    try {
      const response = await fetchWithRetry(
      getAnthropicEndpoint(this.config),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.config.customHeaders,
          'x-api-key': this.config.apiKey,
          'anthropic-version': this.config.anthropicVersion ?? '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(mapAnthropicRequest(request)),
      },
        telemetry.options,
      )
      const parsed = anthropicResponseSchema.safeParse(await parseJsonResponse(response))
      if (!parsed.success) throw new ProviderError('Anthropic 响应格式不正确', 'invalid_response')
      const text = extractAnthropicText(parsed.data.content)
      if (!text) {
        const blockTypes = parsed.data.content.map((block) => block.type).join(', ') || 'none'
        const stopReason = parsed.data.stop_reason ? `（stop_reason: ${parsed.data.stop_reason}）` : ''
        throw new ProviderError(`Anthropic 响应没有 text block${stopReason}，收到类型：${blockTypes}`, 'invalid_response')
      }
      const inputTokens = parsed.data.usage?.input_tokens
      const outputTokens = parsed.data.usage?.output_tokens
      const result: LLMResponse = {
      text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + outputTokens
            : undefined,
      },
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
      messages: [{ role: 'user', content: 'Reply with exactly OK. Do not include any other text.' }],
      // A very small limit can end a thinking/tool-capable Claude response
      // before its first visible text block is emitted.
      maxTokens: 256,
      temperature: 0,
    })
    return makeTestResult(startedAt, response)
  }
}
