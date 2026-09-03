import type {
  ArticleContext,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  SemanticSegment,
  SegmentTranslation,
  TranslationChunk,
} from '../types'
import { TranslationCache } from './cache'
import { translateChunk } from './pipeline'

class SequenceProvider implements LLMProvider {
  requests: LLMRequest[] = []

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      return { text: JSON.stringify({ segments: [
        { id: 'segment-1', translatedText: '初始译文。' },
      ] }) }
    }
    if (this.requests.length === 2) {
      return { text: JSON.stringify({
        verdict: 'rewrite',
        rewritePriorities: ['恢复作者的技术幽默'],
        criticalIssues: [],
        styleIssues: [{
          id: 'segment-1',
          type: 'literal',
          draftEvidence: '无线电与 CDN 通信',
          instruction: '使用自然中文重写。',
        }],
      }) }
    }
    return { text: JSON.stringify({ segments: [
      { id: 'segment-1', translatedText: '无论装什么软件，也没法让这块无线芯片和现代 CDN 对上话。' },
    ] }) }
  }

  async testConnection() {
    return { ok: true, message: 'ok' }
  }
}

class PartialHitCache extends TranslationCache {
  getCalls = 0

  override async get(): Promise<SegmentTranslation | null> {
    this.getCalls += 1
    return this.getCalls === 1
      ? { id: 'segment-0', translatedText: '不应脱离同一 Chunk 单独复用的旧译文。' }
      : null
  }

  override async set(): Promise<void> {}
}

class TwoSegmentProvider implements LLMProvider {
  requests: LLMRequest[] = []

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      return { text: JSON.stringify({ segments: [
        { id: 'segment-0', translatedText: '第一段初译。' },
        { id: 'segment-1', translatedText: '第二段初译。' },
      ] }) }
    }
    if (this.requests.length === 2) {
      return { text: JSON.stringify({
        verdict: 'rewrite',
        rewritePriorities: ['改善两段衔接'],
        criticalIssues: [],
        styleIssues: [{
          id: 'segment-1', type: 'continuity', draftEvidence: '第二段初译。',
          instruction: '承接前一段。',
        }],
      }) }
    }
    return { text: JSON.stringify({ segments: [
      { id: 'segment-0', translatedText: '第一段终稿。' },
      { id: 'segment-1', translatedText: '承接第一段的第二段终稿。' },
    ] }) }
  }

  async testConnection() {
    return { ok: true, message: 'ok' }
  }
}

class RepeatedIssueProvider implements LLMProvider {
  requests: LLMRequest[] = []

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      return { text: JSON.stringify({ segments: [
        { id: 'segment-1', translatedText: '生硬的初始译文。' },
      ] }) }
    }
    if (this.requests.length === 2) {
      return { text: JSON.stringify({
        verdict: 'rewrite',
        rewritePriorities: ['修正两处机械直译'],
        criticalIssues: [],
        styleIssues: [
          {
            id: 'segment-1', type: 'literal', draftEvidence: '生硬',
            instruction: '重组第一处表达。',
          },
          {
            id: 'segment-1', type: 'literal', draftEvidence: '初始译文',
            instruction: '重组第二处表达。',
          },
          {
            id: 'not-in-this-chunk', type: 'literal', draftEvidence: '无关内容',
            instruction: '这个错误 ID 应被忽略。',
          },
        ],
      }) }
    }
    return { text: JSON.stringify({ segments: [
      { id: 'segment-1', translatedText: '自然的最终译文。' },
    ] }) }
  }

  async testConnection() {
    return { ok: true, message: 'ok' }
  }
}

class FixedResponseProvider implements LLMProvider {
  requests: LLMRequest[] = []
  private readonly responses: string[]

  constructor(responses: unknown[]) {
    this.responses = responses.map((response) => typeof response === 'string' ? response : JSON.stringify(response))
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request)
    return { text: this.responses.shift() ?? '{}' }
  }

  async testConnection() {
    return { ok: true, message: 'ok' }
  }
}

function segment(order: number, sourceText: string): SemanticSegment {
  return {
    id: `segment-${order}`,
    tagName: 'p',
    sourceText,
    elementPath: `article > p:nth-of-type(${order + 1})`,
    headingContext: ['Pocket YouTube'],
    order,
  }
}

const articleContext: ArticleContext = {
  topic: 'Old hardware video streaming',
  summary: 'A laptop companion lets a PSP stream video over USB.',
  tone: 'technical and lightly humorous',
  audience: 'developers',
  domain: 'embedded systems',
  translationStyle: ['保留技术幽默'],
  terminology: [],
  namedEntities: [],
}

describe('precision translation pipeline v5', () => {
  it('carries finalized context through draft, chunk review, and rewrite', async () => {
    const provider = new SequenceProvider()
    const segments = [
      segment(0, 'The PSP uses an old Wi-Fi radio.'),
      segment(1, 'No amount of software will make that radio speak to a modern CDN.'),
      segment(2, 'But a USB cable is fast enough if you are careful.'),
    ]
    const chunk: TranslationChunk = {
      id: 'chunk-1',
      segmentIds: ['segment-1'],
      headingContext: ['Pocket YouTube'],
      estimatedTokens: 30,
    }

    const result = await translateChunk(chunk, segments, {
      provider,
      providerType: 'openai-compatible',
      model: 'test-model',
      articleContext,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      translationMode: 'precision',
      terminology: 'CDN = CDN（保留原文）',
      customInstruction: '',
      cache: new TranslationCache(),
      previousFinalTranslations: [{
        id: 'segment-0',
        translatedText: 'PSP 使用的是一块老旧的 Wi-Fi 芯片。',
      }],
    })

    expect(result[0].translatedText).toContain('对上话')
    expect(provider.requests).toHaveLength(3)
    expect(provider.requests[0].messages[0].content).toContain('PSP 使用的是一块老旧的 Wi-Fi 芯片。')
    expect(provider.requests[0].messages[0].content).toContain('CDN = CDN（保留原文）')
    expect(provider.requests[1].messages[0].content).toContain('Review this Chunk as continuous prose')
    expect(provider.requests[1].messages[0].content).toContain('sourceEvidence')
    expect(provider.requests[2].messages[0].content).toContain('无线电与 CDN 通信')
  })

  it('retranslates a whole Chunk when only part of its cache is available', async () => {
    const provider = new TwoSegmentProvider()
    const cache = new PartialHitCache()
    const segments = [
      segment(0, 'The first paragraph establishes the argument.'),
      segment(1, 'The second paragraph completes it.'),
    ]
    const result = await translateChunk({
      id: 'chunk-1',
      segmentIds: ['segment-0', 'segment-1'],
      headingContext: ['One argument'],
      estimatedTokens: 30,
    }, segments, {
      provider,
      providerType: 'openai-compatible',
      model: 'test-model',
      articleContext,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      translationMode: 'precision',
      terminology: '',
      customInstruction: '',
      cache,
    })

    expect(cache.getCalls).toBe(2)
    expect(provider.requests).toHaveLength(3)
    expect(provider.requests[0].messages[0].content).toContain('segment-0')
    expect(provider.requests[0].messages[0].content).toContain('segment-1')
    expect(result.map((item) => item.translatedText)).toEqual([
      '第一段终稿。',
      '承接第一段的第二段终稿。',
    ])
  })

  it('accepts multiple review findings of the same type for one long segment', async () => {
    const provider = new RepeatedIssueProvider()
    const segments = [
      segment(0, 'Previous context.'),
      segment(1, 'One long paragraph can contain multiple literal translations that need separate fixes.'),
    ]
    const result = await translateChunk({
      id: 'chunk-1', segmentIds: ['segment-1'],
      headingContext: ['Review'], estimatedTokens: 30,
    }, segments, {
      provider,
      providerType: 'openai-compatible',
      model: 'test-model',
      articleContext,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      translationMode: 'precision',
      terminology: '',
      customInstruction: '',
      cache: new TranslationCache(),
      bypassCache: true,
    })

    expect(provider.requests).toHaveLength(3)
    expect(provider.requests[2].messages[0].content).not.toContain('not-in-this-chunk')
    expect(result).toEqual([{ id: 'segment-1', translatedText: '自然的最终译文。' }])
  })

  it('routes each stage and its JSON repair through the configured model', async () => {
    const primary = new FixedResponseProvider([])
    const initial = new FixedResponseProvider([
      { segments: [{ id: 'segment-1', translatedText: '初译。' }] },
    ])
    const review = new FixedResponseProvider([
      'not json',
      { verdict: 'pass', rewritePriorities: [], criticalIssues: [], styleIssues: [] },
    ])
    const refinement = new FixedResponseProvider([
      'not json',
      { segments: [{ id: 'segment-1', translatedText: '终稿。' }] },
    ])
    const segments = [segment(1, 'A source paragraph.')]

    const result = await translateChunk({
      id: 'chunk-routed', segmentIds: ['segment-1'], headingContext: [], estimatedTokens: 10,
    }, segments, {
      provider: primary,
      providerType: 'openai-compatible',
      model: 'primary-model',
      stageProviders: {
        initial: { provider: initial, providerId: 'initial', providerType: 'openai-compatible', model: 'initial-model' },
        review: { provider: review, providerId: 'review', providerType: 'anthropic', model: 'review-model' },
        refinement: { provider: refinement, providerId: 'refine', providerType: 'openai-responses', model: 'refine-model' },
      },
      articleContext,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      translationMode: 'precision',
      terminology: '',
      customInstruction: '',
      cache: new TranslationCache(),
      bypassCache: true,
    })

    expect(primary.requests).toHaveLength(0)
    expect(initial.requests.map((request) => request.model)).toEqual(['initial-model'])
    expect(review.requests.map((request) => request.model)).toEqual(['review-model', 'review-model'])
    expect(refinement.requests.map((request) => request.model)).toEqual(['refine-model', 'refine-model'])
    expect(result).toEqual([{ id: 'segment-1', translatedText: '终稿。' }])
  })
})
