import type { SemanticSegment } from '../types'
import { createTranslationChunks, estimateTokens } from './chunker'

function segment(order: number, tagName: string, text: string, headingContext: string[] = []): SemanticSegment {
  return { id: `segment-${order}`, tagName, sourceText: text, elementPath: `#s${order}`, order, headingContext }
}

describe('translation chunker', () => {
  it('keeps order, never splits a paragraph, and honors token budget between segments', () => {
    const segments = [
      segment(0, 'h1', 'Architecture'),
      segment(1, 'p', 'A'.repeat(500), ['Architecture']),
      segment(2, 'p', 'B'.repeat(500), ['Architecture']),
      segment(3, 'h2', 'Caching', ['Architecture', 'Caching']),
      segment(4, 'p', 'C'.repeat(500), ['Architecture', 'Caching']),
    ]
    const chunks = createTranslationChunks(segments, { maxTokens: 220 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((chunk) => chunk.segmentIds)).toEqual(segments.map((item) => item.id))
    expect(chunks.every((chunk) => chunk.segmentIds.length > 0)).toBe(true)
  })

  it('estimates non-Latin text as more tokens per character', () => {
    expect(estimateTokens('中文文本')).toBeGreaterThan(estimateTokens('text'))
  })
})
