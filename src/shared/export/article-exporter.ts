import type { SemanticSegment } from '../types'
import type { ExportArticle, ExportContentMode } from './export-types'
import { serializeArticleToBlocks } from './markdown-serializer'

function firstText(root: ParentNode, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = root.querySelector(selector)
    const value = element?.getAttribute('content')
      || element?.getAttribute('datetime')
      || element?.textContent
    if (value?.trim()) return value.trim()
  }
  return undefined
}

function findMetadata(root: HTMLElement) {
  const document = root.ownerDocument
  return {
    author: firstText(document, [
      'meta[name="author"]', 'meta[property="article:author"]',
      '[itemprop="author"] [itemprop="name"]', '[rel="author"]',
    ]),
    publishedAt: firstText(document, [
      'meta[property="article:published_time"]', 'meta[name="date"]',
      'time[itemprop="datePublished"][datetime]', 'time[datetime]',
    ]),
    description: firstText(document, [
      'meta[name="description"]', 'meta[property="og:description"]',
    ]),
    sourceLanguage: document.documentElement.lang?.trim() || undefined,
  }
}

export function createExportArticle(input: {
  root: HTMLElement
  rootElementPath: string
  segments: SemanticSegment[]
  title: string
  sourceUrl: string
  targetLanguage?: string
  exportMode: ExportContentMode
  exportedAt?: string
}): ExportArticle {
  const { blocks, media } = serializeArticleToBlocks({
    root: input.root,
    segments: input.segments,
    baseUrl: input.sourceUrl,
  })
  const metadata = findMetadata(input.root)
  return {
    metadata: {
      title: input.title,
      sourceUrl: input.sourceUrl,
      sourceLanguage: metadata.sourceLanguage,
      targetLanguage: input.targetLanguage,
      author: metadata.author,
      publishedAt: metadata.publishedAt,
      description: metadata.description,
      exportMode: input.exportMode,
      exportedAt: input.exportedAt ?? new Date().toISOString(),
    },
    rootElementPath: input.rootElementPath,
    blocks,
    media,
  }
}
