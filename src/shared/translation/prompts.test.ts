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
      terminology: 'CDN = CDN（保留原文）',
    })
    expect(prompt).toContain('<TRANSLATE_THIS>')
    expect(prompt).toContain('<CONTEXT_BEFORE>')
    expect(prompt).toContain('never translate or output their segments')
    expect(prompt).toContain('you may split, combine, and reorder sentences')
    expect(prompt).toContain('translatedText')
    expect(prompt).toContain('<USER_GLOSSARY priority="highest">')
    expect(prompt).toContain('CDN = CDN（保留原文）')
    expect(prompt).toContain('described as')
    expect(prompt).toContain('double newlines')
    expect(prompt).toContain('outlining means “概述/勾勒”')
    expect(prompt).toContain('normally creating 2–3 paragraphs')
    expect(prompt).toContain('closing callback')
  })

  it('reviews the chunk as continuous prose and refines by rewriting', () => {
    const draft = [{ id: 'segment-2', translatedText: '任何软件都不能让无线电与 CDN 通信。' }]
    const reviewPrompt = buildReviewPrompt({
      context,
      targetLanguage: 'zh-CN',
      window,
      translations: draft,
    })
    expect(reviewPrompt).toContain('Review this Chunk as continuous prose')
    expect(reviewPrompt).toContain('must quote brief sourceEvidence and draftEvidence')
    expect(reviewPrompt).toContain('abstract nouns that obscure who did what')
    expect(reviewPrompt).toContain('do not fragment one logical chain')

    const refinePrompt = buildRefinePrompt({
      context,
      targetLanguage: 'zh-CN',
      window,
      translations: draft,
      review: {
        verdict: 'rewrite',
        rewritePriorities: ['恢复比喻'],
        criticalIssues: [],
        styleIssues: [{
          id: 'segment-2',
          type: 'literal',
          draftEvidence: '无线电与 CDN 通信',
          instruction: '恢复原文比喻。',
        }],
      },
    })
    expect(refinePrompt).toContain('Do not merely swap a few words')
    expect(refinePrompt).toContain('rebuild rhythm')
    expect(refinePrompt).toContain('natural, coherent long-form prose')
    expect(refinePrompt).toContain('Before output, silently compare source and final translation')
    expect(refinePrompt).toContain('remove abstract nesting, repetition, and invalid collocations')
  })
})
