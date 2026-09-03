import type {
  SemanticSegment,
  SegmentTranslation,
  TranslationChunk,
  TranslationContextSegment,
  TranslationContextWindow,
} from '../types'
import { estimateTokens } from './chunker'

const DEFAULT_CONTEXT_TOKENS = 900
const BEFORE_RATIO = 0.6

function clipToTokenBudget(text: string, budget: number, fromEnd: boolean): string {
  if (estimateTokens(text) <= budget) return text
  const approximateChars = Math.max(120, budget * 3)
  return fromEnd
    ? `…${text.slice(-approximateChars)}`
    : `${text.slice(0, approximateChars)}…`
}

function collectContext(
  segments: SemanticSegment[],
  budget: number,
  fromEnd: boolean,
  translations: Map<string, string>,
): TranslationContextSegment[] {
  const source = fromEnd ? [...segments].reverse() : segments
  const result: TranslationContextSegment[] = []
  let usedTokens = 0

  for (const segment of source) {
    const remaining = budget - usedTokens
    if (remaining <= 0) break
    const translatedText = translations.get(segment.id)
    const sourceTokens = estimateTokens(segment.sourceText)
    const translationTokens = translatedText ? estimateTokens(translatedText) : 0
    const fullTokens = sourceTokens + translationTokens
    if (fullTokens > remaining && result.length > 0) break
    const sourceBudget = translatedText
      ? Math.max(80, Math.floor(remaining * 0.48))
      : remaining
    const translationBudget = Math.max(0, remaining - Math.min(sourceTokens, sourceBudget))
    result.push({
      id: segment.id,
      text: clipToTokenBudget(segment.sourceText, sourceBudget, fromEnd),
      translatedText: translatedText
        ? clipToTokenBudget(translatedText, translationBudget, fromEnd)
        : undefined,
    })
    usedTokens += Math.min(fullTokens, remaining)
  }

  return fromEnd ? result.reverse() : result
}

export function buildTranslationContextWindow(input: {
  chunk: TranslationChunk
  targetSegments: SemanticSegment[]
  allSegments: SemanticSegment[]
  previousFinalTranslations?: SegmentTranslation[]
  maxContextTokens?: number
}): TranslationContextWindow {
  const targetIds = new Set(input.targetSegments.map((segment) => segment.id))
  const positions = input.allSegments
    .map((segment, index) => targetIds.has(segment.id) ? index : -1)
    .filter((index) => index >= 0)
  const firstPosition = Math.min(...positions)
  const lastPosition = Math.max(...positions)
  const contextBudget = Math.max(240, input.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS)
  const beforeBudget = Math.floor(contextBudget * BEFORE_RATIO)
  const afterBudget = contextBudget - beforeBudget
  const translations = new Map(
    (input.previousFinalTranslations ?? []).map((item) => [item.id, item.translatedText]),
  )

  return {
    headingContext: input.chunk.headingContext,
    contextBefore: Number.isFinite(firstPosition)
      ? collectContext(input.allSegments.slice(0, firstPosition), beforeBudget, true, translations)
      : [],
    translateThis: input.targetSegments.map((segment) => ({
      id: segment.id,
      text: segment.sourceText,
    })),
    contextAfter: Number.isFinite(lastPosition)
      ? collectContext(input.allSegments.slice(lastPosition + 1), afterBudget, false, translations)
      : [],
  }
}

export function updateTranslationMemory(
  existing: SegmentTranslation[] | undefined,
  completed: SegmentTranslation[],
  maxSegments = 24,
): SegmentTranslation[] {
  const merged = new Map((existing ?? []).map((item) => [item.id, item]))
  for (const item of completed) {
    merged.delete(item.id)
    merged.set(item.id, item)
  }
  return [...merged.values()].slice(-Math.max(1, maxSegments))
}

export function mergeSegmentTranslations(
  existing: SegmentTranslation[] | undefined,
  completed: SegmentTranslation[],
): SegmentTranslation[] {
  const merged = new Map((existing ?? []).map((item) => [item.id, item]))
  for (const item of completed) merged.set(item.id, item)
  return [...merged.values()]
}
