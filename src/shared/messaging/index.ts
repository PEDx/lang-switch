import { z } from 'zod'
import { semanticSegmentSchema } from '../schemas'

export const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DETECT_ARTICLE') }),
  z.object({ type: z.literal('GET_PAGE_STATE') }),
  z.object({ type: z.literal('RESET_ARTICLE_REGION') }),
  z.object({
    type: z.literal('PREPARE_ARTICLE_EXPORT'),
    contentMode: z.enum(['source', 'translated', 'bilingual']),
    targetLanguage: z.string().optional(),
  }),
  z.object({ type: z.literal('GET_CONTENT_CONFIG') }),
  z.object({ type: z.literal('GET_TASK'), tabId: z.number() }),
  z.object({ type: z.literal('CLEAR_TASK'), tabId: z.number() }),
  z.object({ type: z.literal('GET_EXPORT_TASK'), tabId: z.number() }),
  z.object({
    type: z.literal('START_EXPORT'),
    tabId: z.number(),
    article: z.unknown(),
    options: z.unknown(),
  }),
  z.object({ type: z.literal('CANCEL_EXPORT'), taskId: z.string() }),
  z.object({ type: z.literal('GET_DIAGNOSTIC_LOGS'), tabId: z.number().optional() }),
  z.object({ type: z.literal('CLEAR_DIAGNOSTIC_LOGS'), tabId: z.number().optional() }),
  z.object({
    type: z.literal('START_TRANSLATION'),
    tabId: z.number().optional(),
    allowPartialRegion: z.boolean().optional(),
  }),
  z.object({ type: z.literal('PAUSE_TRANSLATION'), taskId: z.string() }),
  z.object({ type: z.literal('RESUME_TRANSLATION'), taskId: z.string() }),
  z.object({ type: z.literal('STOP_TRANSLATION'), taskId: z.string() }),
  z.object({ type: z.literal('RESTORE_PAGE') }),
  z.object({
    type: z.literal('SET_DISPLAY_MODE'),
    mode: z.enum(['bilingual', 'translation', 'original']),
    opacity: z.number().min(0.1).max(1).optional(),
    translationStyle: z.enum(['immersive', 'highlight']).optional(),
    translationLineHeight: z.number().min(1).max(3).nullable().optional(),
    translationFont: z.enum(['default', 'serif', 'sans']).optional(),
  }),
  z.object({ type: z.literal('START_REGION_PICKER') }),
  z.object({ type: z.literal('CANCEL_REGION_PICKER') }),
  z.object({ type: z.literal('VALIDATE_SELECTOR'), selector: z.string() }),
  z.object({ type: z.literal('USE_SELECTOR'), selector: z.string() }),
  z.object({ type: z.literal('PREVIEW_SELECTOR'), selector: z.string() }),
  z.object({
    type: z.literal('RETRANSLATE_SEGMENT'),
    segmentId: z.string(),
    instruction: z.string().optional(),
  }),
  z.object({ type: z.literal('TEST_PROVIDER'), providerId: z.string() }),
  z.object({ type: z.literal('TASK_UPDATED'), task: z.unknown() }),
  z.object({ type: z.literal('EXPORT_UPDATED'), task: z.unknown() }),
  z.object({ type: z.literal('DIAGNOSTIC_LOG_UPDATED'), entry: z.unknown() }),
  z.object({ type: z.literal('REGION_SELECTED'), selector: z.string() }),
  z.object({ type: z.literal('REGION_PICKER_CANCELLED') }),
  z.object({ type: z.literal('PAGE_NAVIGATED'), url: z.string() }),
  z.object({
    type: z.literal('RENDER_TRANSLATION'),
    segmentId: z.string(),
    translatedText: z.string(),
    showToolbar: z.boolean().optional(),
    segment: semanticSegmentSchema.optional(),
  }),
  z.object({
    type: z.literal('RENDER_TRANSLATIONS'),
    translations: z.array(z.object({
      segmentId: z.string(),
      translatedText: z.string(),
      segment: semanticSegmentSchema.optional(),
    })),
    showToolbar: z.boolean().optional(),
    mode: z.enum(['bilingual', 'translation', 'original']),
    opacity: z.number().min(0.1).max(1),
    translationStyle: z.enum(['immersive', 'highlight']).optional(),
    translationLineHeight: z.number().min(1).max(3).nullable().optional(),
    translationFont: z.enum(['default', 'serif', 'sans']).optional(),
  }),
])

export type ExtensionMessage = z.infer<typeof messageSchema>

export async function sendToActiveTab<T>(message: ExtensionMessage): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab.id) throw new Error('找不到当前标签页')
  return chrome.tabs.sendMessage(tab.id, message) as Promise<T>
}
