export type DisplayMode = 'bilingual' | 'translation' | 'original'
export type TranslationDisplayStyle = 'immersive' | 'highlight'
export type TranslationLineHeight = number | null
export type TranslationFont = 'default' | 'serif' | 'sans'
export type ThemeMode = 'system' | 'light' | 'dark'
export type TranslationMode = 'precision' | 'fast'

export interface ArticleRegionResult {
  selector: string
  elementId: string
  confidence: number
  textLength: number
  paragraphCount: number
  headingCount: number
  reasons: string[]
}

export interface SemanticSegment {
  id: string
  tagName: string
  sourceText: string
  elementPath: string
  headingContext?: string[]
  order: number
}

export interface ArticleContext {
  topic: string
  summary: string
  tone: string
  audience: string
  domain: string
  translationStyle: string[]
  terminology: Array<{
    source: string
    target: string
    keepOriginal?: boolean
    explanation?: string
  }>
  namedEntities: Array<{
    source: string
    preferredForm: string
  }>
}

export interface TranslationChunk {
  id: string
  segmentIds: string[]
  headingContext: string[]
  previousSummary?: string
  nextContextPreview?: string
  estimatedTokens: number
}

export interface TranslationContextSegment {
  id: string
  text: string
  translatedText?: string
}

export interface TranslationContextWindow {
  headingContext: string[]
  contextBefore: TranslationContextSegment[]
  translateThis: Array<{ id: string; text: string }>
  contextAfter: TranslationContextSegment[]
}

export interface LLMRequest {
  model: string
  system?: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
}

export interface LLMRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxRetries?: number
  requestId?: string
  operation?: string
  onTelemetry?: (event: ProviderRequestTelemetryEvent) => void
}

export type ProviderRequestTelemetryEventType =
  | 'request-started'
  | 'attempt-started'
  | 'response-received'
  | 'retry-scheduled'
  | 'request-completed'
  | 'request-failed'

export interface ProviderRequestTelemetryEvent {
  type: ProviderRequestTelemetryEventType
  requestId: string
  operation: string
  timestamp: number
  attempt?: number
  maxAttempts: number
  timeoutMs: number
  elapsedMs: number
  attemptElapsedMs?: number
  status?: number
  retryDelayMs?: number
  errorCode?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface LLMResponse {
  text: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  raw?: unknown
}

export interface LLMStreamEvent {
  type: 'text' | 'done'
  text?: string
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export interface LLMProvider {
  complete(request: LLMRequest, options?: LLMRequestOptions): Promise<LLMResponse>
  stream?(
    request: LLMRequest,
    options?: LLMRequestOptions,
  ): AsyncIterable<LLMStreamEvent>
  testConnection(): Promise<ProviderTestResult>
}

export interface ProviderAdvancedConfig {
  endpoint?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  maxConcurrency?: number
}

export interface OpenAICompatibleConfig extends ProviderAdvancedConfig {
  id: string
  name: string
  type: 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
  customHeaders?: Record<string, string>
}

export interface OpenAIResponsesConfig extends ProviderAdvancedConfig {
  id: string
  name: string
  type: 'openai-responses'
  baseUrl: string
  apiKey: string
  model: string
  customHeaders?: Record<string, string>
}

export interface AnthropicConfig extends ProviderAdvancedConfig {
  id: string
  name: string
  type: 'anthropic'
  baseUrl: string
  apiKey: string
  model: string
  anthropicVersion?: string
  customHeaders?: Record<string, string>
}

export type ProviderConfig = OpenAICompatibleConfig | OpenAIResponsesConfig | AnthropicConfig

export type TranslationStage = 'analysis' | 'initial' | 'review' | 'refinement'

export type TranslationStageProviderIds = Partial<Record<TranslationStage, string>>

export interface SiteRule {
  id: string
  hostname: string
  pathnamePattern?: string
  selector: string
  createdAt: number
  updatedAt: number
}

export type TranslationTaskStatus =
  | 'detecting'
  | 'analyzing'
  | 'translating'
  | 'reviewing'
  | 'refining'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TranslationTaskState {
  taskId: string
  tabId: number
  pageUrl: string
  articleSelector: string
  status: TranslationTaskStatus
  currentStage?: string
  currentSection?: string
  totalSegments: number
  completedSegments: number
  failedSegments: number
  pendingChunkIds: string[]
  completedChunkIds: string[]
  failedChunkIds: string[]
  totalChunks?: number
  currentChunkId?: string
  currentChunkIndex?: number
  chunkProgress?: TranslationChunkProgress[]
  telemetry?: TranslationTaskTelemetry
  providerId: string
  providerName?: string
  providerType?: ProviderConfig['type']
  model?: string
  targetLanguage: string
  sourceLanguage?: string
  displayMode: DisplayMode
  originalOpacity: number
  translationMemory?: SegmentTranslation[]
  translations?: SegmentTranslation[]
  error?: string
  createdAt: number
  updatedAt: number
}

export interface TranslationChunkProgress {
  chunkId: string
  index: number
  segmentCount: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage?: TranslationTaskStatus
  startedAt?: number
  updatedAt?: number
  durationMs?: number
  error?: string
}

export interface ActiveProviderRequest {
  requestId: string
  operation: string
  state: 'requesting' | 'processing' | 'backoff'
  attempt: number
  maxAttempts: number
  startedAt: number
  attemptStartedAt?: number
  timeoutMs: number
  retryAt?: number
  lastHttpStatus?: number
}

export interface TranslationTaskTelemetry {
  startedAt: number
  stageStartedAt: number
  lastActivityAt: number
  totalRequests: number
  completedRequests: number
  failedRequests: number
  retryCount: number
  slowRequestCount: number
  totalLatencyMs: number
  lastLatencyMs?: number
  lastHttpStatus?: number
  lastErrorCode?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  completedChunkDurationMs: number
  estimatedRemainingMs?: number
  activeRequest?: ActiveProviderRequest
}

export interface UserSettings {
  defaultTargetLanguage: string
  primaryProviderId?: string
  translationStageProviderIds?: TranslationStageProviderIds
  /** @deprecated Migrated to primaryProviderId when settings are loaded. */
  defaultProviderId?: string
  displayMode: DisplayMode
  originalOpacity: number
  themeMode: ThemeMode
  translationDisplayStyle: TranslationDisplayStyle
  translationLineHeight: TranslationLineHeight
  translationFont: TranslationFont
  autoUseSiteRules: boolean
  showSegmentToolbar: boolean
  advancedMode: boolean
  maxChunkTokens: number
  maxConcurrency: number
  requestTimeoutMs: number
  terminology: string
  customInstruction: string
  cacheCapacity: number
}

export interface ArticleSnapshot {
  region: ArticleRegionResult
  regionSource?: 'automatic' | 'site-rule' | 'manual'
  regionWarning?: string
  regionCoverage?: ArticleRegionCoverage
  segments: SemanticSegment[]
  pageTitle: string
  articleTitle: string
  url: string
  siteRuleWarning?: string
}

export interface ArticleRegionCoverage {
  ratio: number
  automaticSelector: string
  automaticTextLength: number
  automaticParagraphCount: number
  requiresConfirmation: boolean
  firstHeading?: string
  lastHeading?: string
}

export interface SegmentTranslation {
  id: string
  translatedText: string
}

export interface DiagnosticLogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error'
  scope: 'task' | 'provider' | 'pipeline' | 'render' | 'lifecycle'
  message: string
  tabId?: number
  taskId?: string
  requestId?: string
  chunkId?: string
  operation?: string
  details?: Record<string, string | number | boolean | null>
}
