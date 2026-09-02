import { z } from 'zod'

export const exportContentModeSchema = z.enum(['source', 'translated', 'bilingual'])
export const missingTranslationStrategySchema = z.enum(['omit', 'fallback-to-source', 'mark-untranslated'])
export const bilingualMarkdownLayoutSchema = z.enum(['sequential', 'blockquote', 'divider'])
export const exportMediaModeSchema = z.enum(['remote', 'local'])
export const mediaFailureStrategySchema = z.enum(['keep-remote-url', 'remove-reference', 'abort-export'])
export const exportMediaTypeSchema = z.enum(['image', 'video', 'audio', 'poster'])

export const articleExportMetadataSchema = z.object({
  title: z.string(), sourceUrl: z.string().url(), sourceLanguage: z.string().optional(),
  targetLanguage: z.string().optional(), author: z.string().optional(),
  publishedAt: z.string().optional(), description: z.string().optional(),
  exportMode: exportContentModeSchema, exportedAt: z.string(),
})

export const exportTemplateTokenSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string() }),
  z.object({ type: z.literal('segment'), segmentId: z.string(), linePrefix: z.string().optional() }),
])

export const exportBlockSchema = z.object({
  id: z.string(),
  type: z.enum(['heading', 'paragraph', 'list-item', 'quote', 'code', 'table', 'figure', 'media', 'horizontal-rule', 'details', 'html']),
  sourceMarkdown: z.string(), segmentIds: z.array(z.string()),
  translationTemplate: z.array(exportTemplateTokenSchema).optional(), mediaIds: z.array(z.string()),
})

export const exportMediaResourceSchema = z.object({
  id: z.string(), type: exportMediaTypeSchema, originalUrl: z.string(), resolvedUrl: z.string(),
  mimeType: z.string().optional(), suggestedFilename: z.string().optional(),
  localFilename: z.string().optional(), localPath: z.string().optional(),
  sourceElementPath: z.string().optional(),
})

export const exportArticleSchema = z.object({
  metadata: articleExportMetadataSchema,
  rootElementPath: z.string(),
  blocks: z.array(exportBlockSchema),
  media: z.array(exportMediaResourceSchema),
})

export const mediaDownloadLimitsSchema = z.object({
  maxSingleFileBytes: z.number().int().min(1), maxTotalBytes: z.number().int().min(1),
  maxMediaCount: z.number().int().min(1).max(1000), concurrency: z.number().int().min(1).max(8),
  timeoutMs: z.number().int().min(1000),
})

export const articleExportOptionsSchema = z.object({
  contentMode: exportContentModeSchema, mediaMode: exportMediaModeSchema,
  missingTranslationStrategy: missingTranslationStrategySchema,
  bilingualLayout: bilingualMarkdownLayoutSchema, includeFrontMatter: z.boolean(),
  mediaFailureStrategy: mediaFailureStrategySchema, downloadImages: z.boolean(),
  downloadVideos: z.boolean(), downloadAudio: z.boolean(), downloadPosters: z.boolean(),
  appendSourceLink: z.boolean(), filename: z.string().min(1), limits: mediaDownloadLimitsSchema,
})
