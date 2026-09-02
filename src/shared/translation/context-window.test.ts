import type { SemanticSegment, TranslationChunk } from '../types'
import { buildTranslationContextWindow, updateTranslationMemory } from './context-window'

function segment(order: number, text: string): SemanticSegment {
  return {
    id: `segment-${order}`,
    tagName: 'p',
    sourceText: text,
    elementPath: `article > p:nth-of-type(${order + 1})`,
    headingContext: ['Pocket YouTube'],
    order,
  }
}

describe('translation context window', () => {
  const segments = [
    segment(0, 'The old radio cannot reach a modern CDN.'),
    segment(1, 'A USB cable connects the handheld to a laptop.'),
    segment(2, 'This paragraph is the current translation target.'),
    segment(3, 'The companion process handles TLS and video decoding.'),
    segment(4, 'The handheld renders the interface and plays audio.'),
  ]
  const chunk: TranslationChunk = {
    id: 'chunk-2',
    segmentIds: ['segment-2'],
    headingContext: ['Pocket YouTube'],
    estimatedTokens: 20,
  }

  it('separates translation targets from bounded surrounding context', () => {
    const window = buildTranslationContextWindow({
      chunk,
      targetSegments: [segments[2]],
      allSegments: segments,
      maxContextTokens: 240,
      previousFinalTranslations: [
        { id: 'segment-1', translatedText: '一根 USB 线把掌机连接到笔记本电脑。' },
      ],
    })

    expect(window.translateThis).toEqual([
      { id: 'segment-2', text: segments[2].sourceText },
    ])
    expect(window.contextBefore.at(-1)).toMatchObject({
      id: 'segment-1',
      translatedText: '一根 USB 线把掌机连接到笔记本电脑。',
    })
    expect(window.contextAfter[0].id).toBe('segment-3')
    expect(window.contextBefore.some((item) => item.id === 'segment-2')).toBe(false)
    expect(window.contextAfter.some((item) => item.id === 'segment-2')).toBe(false)
  })

  it('keeps only the most recent finalized translations', () => {
    const memory = updateTranslationMemory(
      [{ id: 'segment-1', translatedText: '旧译文' }],
      [
        { id: 'segment-1', translatedText: '新译文' },
        { id: 'segment-2', translatedText: '第二段' },
        { id: 'segment-3', translatedText: '第三段' },
      ],
      2,
    )
    expect(memory).toEqual([
      { id: 'segment-2', translatedText: '第二段' },
      { id: 'segment-3', translatedText: '第三段' },
    ])
  })
})
