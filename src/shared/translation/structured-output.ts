import { z } from 'zod'
import type { LLMProvider, LLMRequestOptions, SegmentTranslation } from '../types'
import { reviewResponseSchema, translationResponseSchema } from '../schemas'
import { buildRepairPrompt } from './prompts'

export function extractJsonText(raw: string): string {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    const objectStart = trimmed.indexOf('{')
    const objectEnd = trimmed.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1)
    const arrayStart = trimmed.indexOf('[')
    const arrayEnd = trimmed.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1)
    return trimmed
  }
}

export function parseModelJson(raw: string): unknown {
  return JSON.parse(extractJsonText(raw)) as unknown
}

type StructuredOutputNormalizer = (raw: unknown) => unknown

export function validateSegmentTranslations(
  raw: unknown,
  expectedIds: string[],
): SegmentTranslation[] {
  const parsed = translationResponseSchema.parse(raw)
  const expected = new Set(expectedIds)
  const received = new Map<string, SegmentTranslation>()
  for (const segment of parsed.segments) {
    if (!expected.has(segment.id)) throw new Error(`模型返回未知 segment ID: ${segment.id}`)
    if (received.has(segment.id)) throw new Error(`模型重复返回 segment ID: ${segment.id}`)
    received.set(segment.id, segment)
  }
  const missing = expectedIds.filter((id) => !received.has(id))
  if (missing.length > 0) throw new Error(`模型缺少 segment: ${missing.join(', ')}`)
  if (received.size !== expectedIds.length) throw new Error('模型返回的段落数量不一致')
  return expectedIds.map((id) => received.get(id)!)
}

export async function parseWithOneRepair<T>(input: {
  raw: string
  schema: z.ZodType<T>
  provider: LLMProvider
  model: string
  shape: string
  normalize?: StructuredOutputNormalizer
  signal?: AbortSignal
  onRepair?: () => void | Promise<void>
  requestOptions?: Omit<LLMRequestOptions, 'signal'>
}): Promise<T> {
  const parse = (raw: unknown): T => input.schema.parse(input.normalize ? input.normalize(raw) : raw)
  try {
    return parse(parseModelJson(input.raw))
  } catch {
    await input.onRepair?.()
    const repaired = await input.provider.complete(
      {
        model: input.model,
        system: 'You repair JSON structure without changing its content.',
        messages: [{ role: 'user', content: buildRepairPrompt(input.raw, input.shape) }],
        responseFormat: 'json',
        temperature: 0,
      },
      {
        ...input.requestOptions,
        signal: input.signal,
        operation: `${input.requestOptions?.operation ?? 'structured-output'}:json-repair`,
        requestId: undefined,
      },
    )
    return parse(parseModelJson(repaired.text))
  }
}

export { reviewResponseSchema }
