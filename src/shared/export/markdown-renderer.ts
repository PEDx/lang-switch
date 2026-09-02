import type { SegmentTranslation } from '../types'
import type {
  ArticleExportOptions,
  ArticleExportMetadata,
  ExportArticle,
  ExportBlock,
} from './export-types'
import { escapeMarkdownText } from './markdown-serializer'

export interface MarkdownRenderResult {
  markdown: string
  incompleteTranslation: boolean
  missingTranslationCount: number
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, ' '))
}

export function renderFrontMatter(metadata: ArticleExportMetadata): string {
  const fields: Array<[string, string | undefined]> = [
    ['title', metadata.title],
    ['source_url', metadata.sourceUrl],
    ['source_language', metadata.sourceLanguage],
    ['target_language', metadata.targetLanguage],
    ['export_mode', metadata.exportMode],
    ['exported_at', metadata.exportedAt],
    ['author', metadata.author],
    ['published_at', metadata.publishedAt],
    ['description', metadata.description],
  ]
  return `---\n${fields.filter(([, value]) => value).map(([key, value]) => `${key}: ${yamlString(value!)}`).join('\n')}\n---`
}

function escapeTranslation(value: string, block: ExportBlock): string {
  const escaped = escapeMarkdownText(value.trim())
  if (block.type === 'table') return escaped.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
  return escaped
}

function renderTranslatedBlock(
  block: ExportBlock,
  translations: Map<string, string>,
  options: ArticleExportOptions,
): { markdown: string; missing: number } {
  if (!block.translationTemplate || block.segmentIds.length === 0) {
    return { markdown: block.sourceMarkdown, missing: 0 }
  }
  const missingIds = block.segmentIds.filter((id) => !translations.get(id)?.trim())
  if (missingIds.length > 0) {
    if (options.missingTranslationStrategy === 'omit') return { markdown: '', missing: missingIds.length }
    if (options.missingTranslationStrategy === 'fallback-to-source') {
      return { markdown: block.sourceMarkdown, missing: missingIds.length }
    }
    return {
      markdown: `<!-- 此段尚未翻译 -->\n\n${block.sourceMarkdown}`,
      missing: missingIds.length,
    }
  }
  const markdown = block.translationTemplate.map((token) => {
    if (token.type === 'text') return token.value
    const value = escapeTranslation(translations.get(token.segmentId)!, block)
    return token.linePrefix
      ? value.split(/\r?\n/).map((line) => `${token.linePrefix}${line}`).join('\n')
      : value
  }).join('').trim()
  return { markdown, missing: 0 }
}

function bilingualBlock(source: string, translated: string, layout: ArticleExportOptions['bilingualLayout']): string {
  if (layout === 'blockquote') {
    const quote = translated.split(/\r?\n/).map((line) => `> ${line}`).join('\n')
    return `${source}\n\n${quote}`
  }
  if (layout === 'divider') return `${source}\n\n---\n\n${translated}`
  return `${source}\n\n**译文：**\n\n${translated}`
}

function joinBlocks(values: Array<{ block: ExportBlock; markdown: string }>): string {
  let result = ''
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index]
    const previous = values[index - 1]
    if (!current.markdown) continue
    if (result) {
      result += previous?.block.type === 'list-item' && current.block.type === 'list-item'
        ? '\n'
        : '\n\n'
    }
    result += current.markdown
  }
  return result
}

export function renderArticleMarkdown(input: {
  article: ExportArticle
  translations?: SegmentTranslation[]
  options: ArticleExportOptions
}): MarkdownRenderResult {
  const translations = new Map((input.translations ?? []).map((item) => [item.id, item.translatedText]))
  let missingTranslationCount = 0
  const rendered = input.article.blocks.map((block) => {
    if (input.options.contentMode === 'source') return { block, markdown: block.sourceMarkdown }
    const translated = renderTranslatedBlock(block, translations, input.options)
    missingTranslationCount += translated.missing
    if (input.options.contentMode === 'translated') return { block, markdown: translated.markdown }
    if (!block.translationTemplate) return { block, markdown: block.sourceMarkdown }
    return {
      block,
      markdown: translated.markdown
        ? bilingualBlock(block.sourceMarkdown, translated.markdown, input.options.bilingualLayout)
        : block.sourceMarkdown,
    }
  })
  const metadata = { ...input.article.metadata, exportMode: input.options.contentMode }
  const parts = [
    input.options.includeFrontMatter ? renderFrontMatter(metadata) : '',
    joinBlocks(rendered),
    input.options.appendSourceLink ? `原文链接：${input.article.metadata.sourceUrl}` : '',
  ].filter(Boolean)
  return {
    markdown: `${parts.join('\n\n')}\n`,
    incompleteTranslation: input.options.contentMode !== 'source' && missingTranslationCount > 0,
    missingTranslationCount,
  }
}
