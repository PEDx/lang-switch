import type {
  ArticleContext,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  SemanticSegment,
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
        overallAssessment: '信息准确，但比喻被翻平了。',
        rewritePriorities: ['恢复作者的技术幽默'],
        continuityIssues: [],
        terminologyIssues: [],
        segmentSuggestions: [{
          id: 'segment-1',
          issues: ['机械直译'],
          suggestion: '使用自然中文重写。',
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

describe('precision translation pipeline v2', () => {
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
      terminology: '',
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
    expect(provider.requests[1].messages[0].content).toContain('把当前 Chunk 当作一段连续文章来审阅')
    expect(provider.requests[2].messages[0].content).toContain('信息准确，但比喻被翻平了。')
  })
})
