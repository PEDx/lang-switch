import type { SemanticSegment, TranslationChunk } from '../types'

export interface ChunkOptions {
  maxTokens: number
  charsPerToken?: number
  nextPreviewChars?: number
}

export function estimateTokens(text: string, charsPerToken = 3): number {
  let latin = 0
  for (const character of text) {
    if (character.codePointAt(0)! <= 127) latin += 1
  }
  const nonLatin = text.length - latin
  return Math.ceil(latin / Math.max(1, charsPerToken) + nonLatin / 1.5)
}

export function createTranslationChunks(
  segments: SemanticSegment[],
  options: ChunkOptions,
): TranslationChunk[] {
  if (segments.length === 0) return []
  const maxTokens = Math.max(200, options.maxTokens)
  const chunks: TranslationChunk[] = []
  let current: SemanticSegment[] = []
  let currentTokens = 0

  const flush = () => {
    if (current.length === 0) return
    const last = current[current.length - 1]
    const nextSegment = segments[last.order + 1]
    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      segmentIds: current.map((segment) => segment.id),
      headingContext: current[0].headingContext ?? [],
      nextContextPreview: nextSegment?.sourceText.slice(0, options.nextPreviewChars ?? 280),
      estimatedTokens: currentTokens,
    })
    current = []
    currentTokens = 0
  }

  for (const segment of segments) {
    const segmentTokens = estimateTokens(segment.sourceText, options.charsPerToken)
    const isHeading = /^h[1-6]$/.test(segment.tagName)
    const shouldStartSection = isHeading && current.length >= 3 && currentTokens >= maxTokens * 0.45
    if (current.length > 0 && (currentTokens + segmentTokens > maxTokens || shouldStartSection)) flush()
    current.push(segment)
    currentTokens += segmentTokens
  }
  flush()
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1]
    const lastSegment = segmentById.get(previous.segmentIds.at(-1)!)
    if (lastSegment) {
      chunks[index].previousSummary = `上一分块结尾：${lastSegment.sourceText.slice(-360)}`
    }
  }
  return chunks
}
