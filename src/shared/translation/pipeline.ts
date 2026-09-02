import type {
  ArticleContext,
  LLMProvider,
  LLMRequestOptions,
  ProviderRequestTelemetryEvent,
  SemanticSegment,
  SegmentTranslation,
  TranslationChunk,
} from '../types'
import { translationResponseSchema } from '../schemas'
import { createCacheKey, stableHash, TranslationCache } from './cache'
import { buildTranslationContextWindow } from './context-window'
import {
  buildInitialTranslationPrompt,
  buildRefinePrompt,
  buildReviewPrompt,
} from './prompts'
import { parseWithOneRepair, reviewResponseSchema, validateSegmentTranslations } from './structured-output'

export interface PipelineProgress {
  stage: 'translating' | 'reviewing' | 'refining'
  event: 'started' | 'completed' | 'repairing' | 'cache'
  chunkId: string
  currentSection?: string
  durationMs?: number
  segmentCount?: number
  cacheHitCount?: number
  cacheMissCount?: number
}

export interface TranslationPipelineOptions {
  provider: LLMProvider
  providerType: string
  model: string
  articleContext: ArticleContext
  sourceLanguage: string
  targetLanguage: string
  translationMode: string
  terminology: string
  customInstruction: string
  maxTokens?: number
  cache: TranslationCache
  signal?: AbortSignal
  bypassCache?: boolean
  previousFinalTranslations?: SegmentTranslation[]
  maxContextTokens?: number
  requestTimeoutMs?: number
  maxRetries?: number
  onProviderTelemetry?: (event: ProviderRequestTelemetryEvent) => void
  onProgress?: (progress: PipelineProgress) => void | Promise<void>
}

export const PRECISION_PIPELINE_VERSION = 'translation-agent-v2'

async function requestTranslations(
  provider: LLMProvider,
  model: string,
  prompt: string,
  expectedIds: string[],
  maxTokens: number | undefined,
  requestOptions: LLMRequestOptions,
  operation: string,
  onRepair?: () => void | Promise<void>,
): Promise<SegmentTranslation[]> {
  const response = await provider.complete(
    {
      model,
      system: '你是专业长文译者。忠实保留信息，同时写出自然、连贯、有作者声音的目标语言文章，并严格保持段落 ID。',
      messages: [{ role: 'user', content: prompt }],
      responseFormat: 'json',
      temperature: 0.2,
      maxTokens,
    },
    { ...requestOptions, operation, requestId: undefined },
  )
  const parsed = await parseWithOneRepair({
    raw: response.text,
    schema: translationResponseSchema,
    provider,
    model,
    shape: '{"segments":[{"id":"...","translatedText":"..."}]}',
    signal: requestOptions.signal,
    requestOptions: { ...requestOptions, operation, requestId: undefined },
    onRepair,
  })
  return validateSegmentTranslations(parsed, expectedIds)
}

function createSegmentCacheKey(
  segment: SemanticSegment,
  options: TranslationPipelineOptions,
  continuityHash: string,
) {
  return createCacheKey({
    sourceText: segment.sourceText,
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    providerType: options.providerType,
    model: options.model,
    translationMode: `${options.translationMode}:${PRECISION_PIPELINE_VERSION}`,
    articleContextHash: stableHash(options.articleContext),
    terminologyHash: stableHash(options.terminology),
    customInstructionHash: stableHash(options.customInstruction),
    continuityHash,
  })
}

function validateReviewIds(
  review: { segmentSuggestions: Array<{ id: string }> },
  expectedIds: string[],
): void {
  const expected = new Set(expectedIds)
  const received = new Set<string>()
  for (const suggestion of review.segmentSuggestions) {
    if (!expected.has(suggestion.id)) {
      throw new Error(`审阅返回未知 segment ID: ${suggestion.id}`)
    }
    if (received.has(suggestion.id)) {
      throw new Error(`审阅重复返回 segment ID: ${suggestion.id}`)
    }
    received.add(suggestion.id)
  }
}

export async function translateChunk(
  chunk: TranslationChunk,
  allSegments: SemanticSegment[],
  options: TranslationPipelineOptions,
): Promise<SegmentTranslation[]> {
  const byId = new Map(allSegments.map((segment) => [segment.id, segment]))
  const segments = chunk.segmentIds.map((id) => byId.get(id)).filter(Boolean) as SemanticSegment[]
  const contextWindow = buildTranslationContextWindow({
    chunk,
    targetSegments: segments,
    allSegments,
    previousFinalTranslations: options.previousFinalTranslations,
    maxContextTokens: options.maxContextTokens,
  })
  const continuityHash = stableHash({
    pipeline: PRECISION_PIPELINE_VERSION,
    headingContext: contextWindow.headingContext,
    contextBefore: contextWindow.contextBefore,
  })
  const cached = new Map<string, SegmentTranslation>()
  if (!options.bypassCache) {
    await Promise.all(
      segments.map(async (segment) => {
        const hit = await options.cache.get(createSegmentCacheKey(segment, options, continuityHash))
        if (hit) cached.set(segment.id, hit)
      }),
    )
  }
  const pending = segments.filter((segment) => !cached.has(segment.id))
  await options.onProgress?.({
    stage: 'translating', event: 'cache', chunkId: chunk.id,
    currentSection: chunk.headingContext.at(-1), segmentCount: segments.length,
    cacheHitCount: cached.size, cacheMissCount: pending.length,
  })
  if (pending.length === 0) return chunk.segmentIds.map((id) => cached.get(id)!)

  const requestOptions: LLMRequestOptions = {
    signal: options.signal,
    timeoutMs: options.requestTimeoutMs,
    maxRetries: options.maxRetries,
    onTelemetry: options.onProviderTelemetry,
  }

  const initialStartedAt = Date.now()
  await options.onProgress?.({
    stage: 'translating', event: 'started', chunkId: chunk.id,
    currentSection: chunk.headingContext.at(-1), segmentCount: pending.length,
  })
  const draft = await requestTranslations(
    options.provider,
    options.model,
    buildInitialTranslationPrompt({
      context: options.articleContext,
      targetLanguage: options.targetLanguage,
      window: { ...contextWindow, translateThis: pending.map((segment) => ({ id: segment.id, text: segment.sourceText })) },
      customInstruction: options.customInstruction,
    }),
    pending.map((segment) => segment.id),
    options.maxTokens,
    requestOptions,
    'initial-translation',
    () => options.onProgress?.({
      stage: 'translating', event: 'repairing', chunkId: chunk.id,
      currentSection: chunk.headingContext.at(-1), segmentCount: pending.length,
    }),
  )
  await options.onProgress?.({
    stage: 'translating', event: 'completed', chunkId: chunk.id,
    currentSection: chunk.headingContext.at(-1), durationMs: Date.now() - initialStartedAt,
    segmentCount: pending.length,
  })

  const reviewStartedAt = Date.now()
  await options.onProgress?.({
    stage: 'reviewing', event: 'started', chunkId: chunk.id,
    currentSection: chunk.headingContext.at(-1), segmentCount: pending.length,
  })
  const reviewResponse = await options.provider.complete(
    {
      model: options.model,
      system: '你是严格但克制的双语长文编辑，优先发现影响准确性、作者声音和连续阅读体验的问题。',
      messages: [{ role: 'user', content: buildReviewPrompt({
        context: options.articleContext,
        targetLanguage: options.targetLanguage,
        window: { ...contextWindow, translateThis: pending.map((segment) => ({ id: segment.id, text: segment.sourceText })) },
        translations: draft,
        customInstruction: options.customInstruction,
      }) }],
      responseFormat: 'json',
      temperature: 0.1,
      maxTokens: options.maxTokens,
    },
    { ...requestOptions, operation: 'translation-review', requestId: undefined },
  )
  const review = await parseWithOneRepair({
    raw: reviewResponse.text,
    schema: reviewResponseSchema,
    provider: options.provider,
    model: options.model,
    shape: '{"overallAssessment":"...","rewritePriorities":[],"continuityIssues":[],"terminologyIssues":[],"segmentSuggestions":[{"id":"...","issues":[],"suggestion":"..."}]}',
    signal: options.signal,
    requestOptions: { ...requestOptions, operation: 'translation-review', requestId: undefined },
    onRepair: () => options.onProgress?.({
      stage: 'reviewing', event: 'repairing', chunkId: chunk.id,
      currentSection: chunk.headingContext.at(-1), segmentCount: pending.length,
    }),
  })
  validateReviewIds(review, pending.map((segment) => segment.id))
  await options.onProgress?.({
    stage: 'reviewing', event: 'completed', chunkId: chunk.id,
    currentSection: chunk.headingContext.at(-1), durationMs: Date.now() - reviewStartedAt,
    segmentCount: pending.length,
  })

  const refineStartedAt = Date.now()
  await options.onProgress?.({
    stage: 'refining', event: 'started', chunkId: chunk.id,
    currentSection: chunk.headingContext.at(-1), segmentCount: pending.length,
  })
  const refined = await requestTranslations(
    options.provider,
    options.model,
    buildRefinePrompt({
      context: options.articleContext,
      targetLanguage: options.targetLanguage,
      window: { ...contextWindow, translateThis: pending.map((segment) => ({ id: segment.id, text: segment.sourceText })) },
      translations: draft,
      review,
      customInstruction: options.customInstruction,
    }),
    pending.map((segment) => segment.id),
    options.maxTokens,
    requestOptions,
    'final-refinement',
    () => options.onProgress?.({
      stage: 'refining', event: 'repairing', chunkId: chunk.id,
      currentSection: chunk.headingContext.at(-1), segmentCount: pending.length,
    }),
  )
  await options.onProgress?.({
    stage: 'refining', event: 'completed', chunkId: chunk.id,
    currentSection: chunk.headingContext.at(-1), durationMs: Date.now() - refineStartedAt,
    segmentCount: pending.length,
  })
  for (const segment of pending) {
    const value = refined.find((item) => item.id === segment.id)!
    await options.cache.set(createSegmentCacheKey(segment, options, continuityHash), value)
  }
  const combined = new Map([...cached, ...refined.map((item) => [item.id, item] as const)])
  return chunk.segmentIds.map((id) => combined.get(id)!)
}
