import type {
  ArticleRegionCoverage,
  ArticleRegionResult,
  ArticleSnapshot,
  SemanticSegment,
} from './types'

export const PARTIAL_ARTICLE_COVERAGE_THRESHOLD = 0.5

function headingBoundaries(segments: SemanticSegment[]): {
  firstHeading?: string
  lastHeading?: string
} {
  const headings = segments
    .filter((segment) => /^h[1-6]$/.test(segment.tagName))
    .map((segment) => segment.sourceText)
  return {
    firstHeading: headings[0],
    lastHeading: headings.at(-1),
  }
}

export function createArticleRegionCoverage(
  selected: ArticleRegionResult,
  automatic: ArticleRegionResult,
  segments: SemanticSegment[],
): ArticleRegionCoverage {
  const ratio = Math.min(1, selected.textLength / Math.max(1, automatic.textLength))
  return {
    ratio,
    automaticSelector: automatic.selector,
    automaticTextLength: automatic.textLength,
    automaticParagraphCount: automatic.paragraphCount,
    requiresConfirmation:
      selected.selector !== automatic.selector && ratio < PARTIAL_ARTICLE_COVERAGE_THRESHOLD,
    ...headingBoundaries(segments),
  }
}

export function requiresArticleRegionConfirmation(snapshot: ArticleSnapshot): boolean {
  return snapshot.regionCoverage?.requiresConfirmation === true
}
