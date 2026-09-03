import { z } from 'zod'

export const displayModeSchema = z.enum(['bilingual', 'translation', 'original'])

export const segmentTranslationSchema = z.object({
  id: z.string().min(1),
  translatedText: z.string().trim().min(1),
})

export const translationResponseSchema = z.object({
  segments: z.array(segmentTranslationSchema),
})

export const criticalReviewIssueSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  sourceEvidence: z.string().catch(''),
  draftEvidence: z.string().catch(''),
  instruction: z.string().catch(''),
})

export const styleReviewIssueSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  draftEvidence: z.string().catch(''),
  instruction: z.string().catch(''),
})

export const reviewResponseSchema = z.object({
  verdict: z.enum(['pass', 'rewrite']).catch('rewrite'),
  rewritePriorities: z.array(z.string()).catch([]),
  criticalIssues: z.array(criticalReviewIssueSchema).catch([]),
  styleIssues: z.array(styleReviewIssueSchema).catch([]),
})

export const articleContextSchema = z.object({
  topic: z.string(),
  summary: z.string(),
  tone: z.string(),
  audience: z.string(),
  domain: z.string(),
  translationStyle: z.array(z.string()),
  terminology: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      keepOriginal: z.boolean().optional(),
      explanation: z.string().optional(),
    }),
  ),
  namedEntities: z.array(
    z.object({
      source: z.string(),
      preferredForm: z.string(),
    }),
  ),
})

const providerAdvancedSchema = {
  endpoint: z.string().url().optional().or(z.literal('')),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  maxConcurrency: z.number().int().min(1).max(8).optional(),
}

export const providerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('openai-compatible'),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    customHeaders: z.record(z.string(), z.string()).optional(),
    ...providerAdvancedSchema,
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('openai-responses'),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    customHeaders: z.record(z.string(), z.string()).optional(),
    ...providerAdvancedSchema,
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('anthropic'),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    anthropicVersion: z.string().optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
    ...providerAdvancedSchema,
  }),
])

export const siteRuleSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  pathnamePattern: z.string().optional(),
  selector: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const semanticSegmentSchema = z.object({
  id: z.string(),
  tagName: z.string(),
  sourceText: z.string(),
  elementPath: z.string(),
  headingContext: z.array(z.string()).optional(),
  order: z.number(),
})

export const articleRegionSchema = z.object({
  selector: z.string(),
  elementId: z.string(),
  confidence: z.number(),
  textLength: z.number(),
  paragraphCount: z.number(),
  headingCount: z.number(),
  reasons: z.array(z.string()),
})

export const articleSnapshotSchema = z.object({
  region: articleRegionSchema,
  regionSource: z.enum(['automatic', 'site-rule', 'manual']).optional(),
  regionWarning: z.string().optional(),
  regionCoverage: z.object({
    ratio: z.number().min(0).max(1),
    automaticSelector: z.string(),
    automaticTextLength: z.number(),
    automaticParagraphCount: z.number(),
    requiresConfirmation: z.boolean(),
    firstHeading: z.string().optional(),
    lastHeading: z.string().optional(),
  }).optional(),
  segments: z.array(semanticSegmentSchema),
  pageTitle: z.string(),
  articleTitle: z.string(),
  url: z.string(),
  siteRuleWarning: z.string().optional(),
})
