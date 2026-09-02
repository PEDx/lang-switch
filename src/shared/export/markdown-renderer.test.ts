import type { ExportArticle } from './export-types'
import { DEFAULT_EXPORT_OPTIONS } from './export-types'
import { renderArticleMarkdown } from './markdown-renderer'

const article: ExportArticle = {
  metadata: {
    title: 'Title: "Quoted"', sourceUrl: 'https://example.com/post', sourceLanguage: 'en',
    targetLanguage: 'zh-CN', exportMode: 'source', exportedAt: '2026-07-17T10:00:00+08:00',
  },
  rootElementPath: 'article',
  media: [],
  blocks: [
    { id: 'b1', type: 'heading', sourceMarkdown: '# Original title', segmentIds: ['s1'], mediaIds: [], translationTemplate: [{ type: 'text', value: '# ' }, { type: 'segment', segmentId: 's1' }] },
    { id: 'b2', type: 'paragraph', sourceMarkdown: 'Original paragraph.', segmentIds: ['s2'], mediaIds: [], translationTemplate: [{ type: 'segment', segmentId: 's2' }] },
    { id: 'b3', type: 'code', sourceMarkdown: '```ts\nconst x = 1\n```', segmentIds: [], mediaIds: [] },
  ],
}

describe('Markdown content modes', () => {
  const translations = [{ id: 's1', translatedText: '译文标题' }, { id: 's2', translatedText: '译文段落。' }]

  it('renders source only with YAML front matter', () => {
    const result = renderArticleMarkdown({ article, translations, options: { ...DEFAULT_EXPORT_OPTIONS, filename: 'article' } })
    expect(result.markdown).toContain('title: "Title: \\"Quoted\\""')
    expect(result.markdown).toContain('# Original title')
    expect(result.markdown).not.toContain('译文段落')
  })

  it('renders translated and bilingual modes from stable IDs', () => {
    const translated = renderArticleMarkdown({
      article, translations, options: { ...DEFAULT_EXPORT_OPTIONS, contentMode: 'translated', filename: 'article' },
    })
    expect(translated.markdown).toContain('# 译文标题')
    expect(translated.markdown).not.toContain('Original paragraph')
    expect(translated.markdown).toContain('const x = 1')

    const bilingual = renderArticleMarkdown({
      article, translations, options: { ...DEFAULT_EXPORT_OPTIONS, contentMode: 'bilingual', filename: 'article' },
    })
    expect(bilingual.markdown).toContain('Original paragraph.\n\n**译文：**\n\n译文段落。')
  })

  it.each([
    ['mark-untranslated', '<!-- 此段尚未翻译 -->\n\nOriginal paragraph.'],
    ['fallback-to-source', 'Original paragraph.'],
    ['omit', 'Original paragraph.'],
  ] as const)('handles missing translations with %s', (strategy, expected) => {
    const result = renderArticleMarkdown({
      article,
      translations: [{ id: 's1', translatedText: '译文标题' }],
      options: {
        ...DEFAULT_EXPORT_OPTIONS,
        contentMode: 'translated',
        missingTranslationStrategy: strategy,
        filename: 'article',
      },
    })
    if (strategy === 'omit') expect(result.markdown).not.toContain(expected)
    else expect(result.markdown).toContain(expected)
    expect(result.incompleteTranslation).toBe(true)
    expect(result.missingTranslationCount).toBe(1)
  })
})
