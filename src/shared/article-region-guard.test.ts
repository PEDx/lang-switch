import type { ArticleRegionResult, SemanticSegment } from './types'
import {
  createArticleRegionCoverage,
  requiresArticleRegionConfirmation,
} from './article-region-guard'

const region = (selector: string, textLength: number, paragraphCount: number): ArticleRegionResult => ({
  selector,
  elementId: selector,
  confidence: 0.9,
  textLength,
  paragraphCount,
  headingCount: 1,
  reasons: [],
})

const segments: SemanticSegment[] = [
  { id: 'h-1', tagName: 'h2', sourceText: 'The A* algorithm', elementPath: '#astar', order: 0 },
  { id: 'p-1', tagName: 'p', sourceText: 'Paragraph', elementPath: '#astar + p', order: 1 },
]

describe('article region guard', () => {
  it('requires confirmation when a selected section only covers a small part of the article', () => {
    const coverage = createArticleRegionCoverage(
      region('main > section:nth-of-type(7)', 2_700, 10),
      region('main', 15_188, 60),
      segments,
    )

    expect(coverage.ratio).toBeCloseTo(0.178)
    expect(coverage.requiresConfirmation).toBe(true)
    expect(coverage.firstHeading).toBe('The A* algorithm')
    expect(coverage.lastHeading).toBe('The A* algorithm')
    expect(requiresArticleRegionConfirmation({
      region: region('section', 2_700, 10),
      regionCoverage: coverage,
      segments,
      pageTitle: 'A*',
      articleTitle: 'A*',
      url: 'https://example.com',
    })).toBe(true)
  })

  it('does not warn when the selected and automatic regions are the same', () => {
    const coverage = createArticleRegionCoverage(
      region('main', 15_188, 60),
      region('main', 15_188, 60),
      segments,
    )
    expect(coverage.requiresConfirmation).toBe(false)
  })
})
