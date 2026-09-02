import type {
  ArticleContext,
  SegmentTranslation,
  TranslationContextWindow,
} from '../types'

export const JSON_ONLY = '只返回合法 JSON，不要输出 Markdown、代码围栏或额外说明。'

export interface TranslationReview {
  overallAssessment: string
  rewritePriorities: string[]
  continuityIssues: string[]
  terminologyIssues: string[]
  segmentSuggestions: Array<{
    id: string
    issues: string[]
    suggestion: string
  }>
}

export function buildArticleAnalysisPrompt(input: {
  pageTitle: string
  pageUrl: string
  articleTitle: string
  headings: string[]
  samples: string[]
  terminology: string
  sourceLanguage: string
  targetLanguage: string
}): string {
  return `${JSON_ONLY}
你正在为一篇长文建立全局翻译规范。分析文章主题、作者语气、目标受众、专业领域和重要术语，供后续所有分块共同使用。

要求：
- summary 用 2 至 4 句话概括文章论点与叙事走向，不要逐段复述。
- tone 要具体描述作者声音，例如克制、幽默、带有技术吐槽，而不是只写“正式”。
- translationStyle 给出 3 至 6 条可执行的目标语言写作规则，包含句式、节奏、术语和修辞处理。
- terminology 只收录需要全文统一的专业术语；产品名、API、变量和代码可标记 keepOriginal。
- namedEntities 统一人名、产品名、项目名和组织名。
- 用户术语表优先级最高。

返回对象字段：topic, summary, tone, audience, domain, translationStyle(string[]), terminology({source,target,keepOriginal?,explanation?}[]), namedEntities({source,preferredForm}[])。

<ARTICLE_INPUT>
${JSON.stringify(input)}
</ARTICLE_INPUT>`
}

function compactContext(context: ArticleContext) {
  return {
    topic: context.topic,
    summary: context.summary,
    tone: context.tone,
    audience: context.audience,
    domain: context.domain,
    translationStyle: context.translationStyle,
    terminology: context.terminology,
    namedEntities: context.namedEntities,
  }
}

function renderPassageContext(window: TranslationContextWindow): string {
  return `<CONTEXT_BEFORE>
${JSON.stringify(window.contextBefore)}
</CONTEXT_BEFORE>
<TRANSLATE_THIS>
${JSON.stringify(window.translateThis)}
</TRANSLATE_THIS>
<CONTEXT_AFTER>
${JSON.stringify(window.contextAfter)}
</CONTEXT_AFTER>`
}

export function buildInitialTranslationPrompt(input: {
  context: ArticleContext
  targetLanguage: string
  window: TranslationContextWindow
  customInstruction?: string
}): string {
  return `${JSON_ONLY}
把 <TRANSLATE_THIS> 中的内容翻译为 ${input.targetLanguage}。前后的 CONTEXT 只用于理解全文和保持衔接，绝对不要翻译或输出其中的段落。

这是面向长文阅读的初稿，不是逐词对照稿：
- 完整保留事实、逻辑、限定条件、数字和信息密度，不增译、不漏译。
- 保留作者的语气、幽默、比喻、强调和句间节奏，不要把有个性的表达抹平成说明书。
- 使用自然的目标语言句式，避免照搬源语言语序；允许在同一个段落 ID 内拆句、合句和调整语序。
- 技术术语必须准确且全文一致；代码、URL、API 名、变量名、型号和占位符保持原样。
- CONTEXT_BEFORE 中若有 translatedText，把它作为已经确定的译文风格和术语依据。
- 每个输入 ID 必须恰好返回一次，信息不能跨 ID 移动。
${input.customInstruction ? `- 用户额外要求：${input.customInstruction}` : ''}

返回格式：{"segments":[{"id":"...","translatedText":"..."}]}

<ARTICLE_CONTEXT>
${JSON.stringify({ ...compactContext(input.context), headingContext: input.window.headingContext })}
</ARTICLE_CONTEXT>
${renderPassageContext(input.window)}`
}

export function buildReviewPrompt(input: {
  context: ArticleContext
  targetLanguage: string
  window: TranslationContextWindow
  translations: SegmentTranslation[]
  customInstruction?: string
}): string {
  return `${JSON_ONLY}
你是资深双语长文编辑。把当前 Chunk 当作一段连续文章来审阅，而不是把每个段落孤立挑错。只提出会明显改善最终阅读体验的高价值意见。

重点检查：
- 是否有误译、漏译、擅自补充、指代或技术概念错误。
- 术语、产品名、项目名和上下文是否一致。
- 是否被源语言句式束缚，出现机械直译、搭配生硬或不自然表达。
- 是否保留作者的幽默、比喻、语气、强调和段落推进节奏。
- 段落之间是否像同一篇文章，而不是互不相干的翻译片段。
- CONTEXT 只用于判断衔接，不要要求翻译上下文。

rewritePriorities 最多给出 5 条，按重要性排序。segmentSuggestions 只列确有局部问题的 ID，不必为每段凑意见。
返回格式：{"overallAssessment":"...","rewritePriorities":["..."],"continuityIssues":["..."],"terminologyIssues":["..."],"segmentSuggestions":[{"id":"...","issues":["..."],"suggestion":"..."}]}

<ARTICLE_CONTEXT>
${JSON.stringify({ ...compactContext(input.context), targetLanguage: input.targetLanguage, customInstruction: input.customInstruction, headingContext: input.window.headingContext })}
</ARTICLE_CONTEXT>
${renderPassageContext(input.window)}
<DRAFT_TRANSLATION>
${JSON.stringify(input.translations)}
</DRAFT_TRANSLATION>`
}

export function buildRefinePrompt(input: {
  context: ArticleContext
  targetLanguage: string
  window: TranslationContextWindow
  translations: SegmentTranslation[]
  review: TranslationReview
  customInstruction?: string
}): string {
  return `${JSON_ONLY}
根据原文、文章上下文、初稿和审阅意见，重写 <TRANSLATE_THIS> 的最终 ${input.targetLanguage} 译文。目标是让读者感觉它原本就是一篇自然、连贯、有作者声音的目标语言长文。

重写规则：
- 以原文事实和含义为最高约束，不新增、不遗漏、不弱化限定条件。
- 不要只替换几个词；必要时应在同一个段落 ID 内调整语序、拆句、合句和重建节奏。
- 恢复原文的幽默、比喻、对比、排比和语气，但不要自行发挥。
- 统一术语和命名实体，并与 CONTEXT_BEFORE 中已经完成的 translatedText 保持一致。
- 解决 Chunk 级的衔接问题，使相邻段落自然推进。
- 每个输入 ID 必须恰好返回一次，信息不得跨段移动。
${input.customInstruction ? `- 用户额外要求：${input.customInstruction}` : ''}

返回格式：{"segments":[{"id":"...","translatedText":"..."}]}

<ARTICLE_CONTEXT>
${JSON.stringify({ ...compactContext(input.context), headingContext: input.window.headingContext })}
</ARTICLE_CONTEXT>
${renderPassageContext(input.window)}
<DRAFT_TRANSLATION>
${JSON.stringify(input.translations)}
</DRAFT_TRANSLATION>
<EDITOR_REVIEW>
${JSON.stringify(input.review)}
</EDITOR_REVIEW>`
}

export function buildRepairPrompt(raw: string, expectedShape: string): string {
  return `${JSON_ONLY}\n下面的模型输出格式错误。只修复为 ${expectedShape}，不得改写内容或增删 ID：\n${raw}`
}
