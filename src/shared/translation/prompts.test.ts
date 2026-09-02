import type { ArticleContext, TranslationContextWindow } from '../types'
import {
  buildInitialTranslationPrompt,
  buildRefinePrompt,
  buildReviewPrompt,
} from './prompts'

const context: ArticleContext = {
  topic: 'Running YouTube on a PSP',
  summary: 'A USB-connected companion process lets old hardware play modern video.',
  tone: 'technical, conversational, and lightly humorous',
  audience: 'software developers',
  domain: 'embedded multimedia',
  translationStyle: ['保留技术吐槽', '使用自然中文技术文章句式'],
  terminology: [{ source: 'seek', target: '跳转播放进度' }],
  namedEntities: [{ source: 'PocketJS', preferredForm: 'PocketJS' }],
}

const window: TranslationContextWindow = {
  headingContext: ['Pocket YouTube'],
  contextBefore: [{
    id: 'segment-1',
    text: 'The PSP is connected over USB.',
    translatedText: 'PSP 通过 USB 连接到电脑。',
  }],
  translateThis: [{
    id: 'segment-2',
    text: 'No amount of software will make that radio speak to a 2026 CDN.',
  }],
  contextAfter: [{ id: 'segment-3', text: 'But look at the laptop next to it.' }],
}

describe('translation-agent inspired prompts', () => {
  it('marks only the current passage as the translation target', () => {
    const prompt = buildInitialTranslationPrompt({
      context,
      targetLanguage: 'zh-CN',
      window,
    })
    expect(prompt).toContain('<TRANSLATE_THIS>')
    expect(prompt).toContain('<CONTEXT_BEFORE>')
    expect(prompt).toContain('绝对不要翻译或输出其中的段落')
    expect(prompt).toContain('允许在同一个段落 ID 内拆句、合句和调整语序')
    expect(prompt).toContain('translatedText')
  })

  it('reviews the chunk as continuous prose and refines by rewriting', () => {
    const draft = [{ id: 'segment-2', translatedText: '任何软件都不能让无线电与 CDN 通信。' }]
    const reviewPrompt = buildReviewPrompt({
      context,
      targetLanguage: 'zh-CN',
      window,
      translations: draft,
    })
    expect(reviewPrompt).toContain('把当前 Chunk 当作一段连续文章来审阅')
    expect(reviewPrompt).toContain('segmentSuggestions 只列确有局部问题的 ID')

    const refinePrompt = buildRefinePrompt({
      context,
      targetLanguage: 'zh-CN',
      window,
      translations: draft,
      review: {
        overallAssessment: '准确但翻译腔明显。',
        rewritePriorities: ['恢复比喻'],
        continuityIssues: [],
        terminologyIssues: [],
        segmentSuggestions: [],
      },
    })
    expect(refinePrompt).toContain('不要只替换几个词')
    expect(refinePrompt).toContain('重建节奏')
    expect(refinePrompt).toContain('感觉它原本就是一篇自然、连贯、有作者声音')
  })
})
