import { extractJsonText, parseModelJson, validateSegmentTranslations } from './structured-output'
import { reviewResponseSchema } from '../schemas'
import { normalizeArticleContext } from './article-analyzer'

describe('structured model output', () => {
  it('extracts JSON from fences and surrounding text', () => {
    expect(parseModelJson('```json\n{"segments":[]}\n```')).toEqual({ segments: [] })
    expect(extractJsonText('note {"segments":[]} end')).toBe('{"segments":[]}')
  })

  it('maps translations by stable ID instead of response order', () => {
    const result = validateSegmentTranslations({ segments: [
      { id: 'b', translatedText: '乙' }, { id: 'a', translatedText: '甲' },
    ] }, ['a', 'b'])
    expect(result.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('detects missing, unknown, duplicate, and empty segments', () => {
    expect(() => validateSegmentTranslations({ segments: [{ id: 'a', translatedText: '甲' }] }, ['a', 'b'])).toThrow('缺少')
    expect(() => validateSegmentTranslations({ segments: [{ id: 'x', translatedText: '甲' }] }, ['a'])).toThrow('未知')
    expect(() => validateSegmentTranslations({ segments: [{ id: 'a', translatedText: '甲' }, { id: 'a', translatedText: '乙' }] }, ['a'])).toThrow('重复')
    expect(() => validateSegmentTranslations({ segments: [{ id: 'a', translatedText: '' }] }, ['a'])).toThrow()
  })

  it('validates chunk-level review feedback', () => {
    const review = reviewResponseSchema.parse({
      verdict: 'rewrite',
      rewritePriorities: ['恢复作者的技术幽默'],
      criticalIssues: [],
      styleIssues: [{
        id: 'segment-2',
        type: 'literal',
        draftEvidence: '无线电与 CDN 通信',
        instruction: '保留原文比喻并重组句子。',
      }],
    })
    expect(review.styleIssues[0].id).toBe('segment-2')
  })

  it('tolerates provider-specific review labels and non-critical metadata errors', () => {
    const review = reviewResponseSchema.parse({
      verdict: 'needs_revision',
      rewritePriorities: [],
      criticalIssues: [{
        id: 'segment-1', type: 'mistranslation', sourceEvidence: 'attempting',
        draftEvidence: '竭尽全力', instruction: '恢复原文的语气强度。',
      }],
      styleIssues: [],
    })
    expect(review.verdict).toBe('rewrite')
    expect(review.criticalIssues[0].type).toBe('mistranslation')
  })

  it('normalizes malformed optional analysis values from smaller models', () => {
    expect(normalizeArticleContext({
      topic: 'Pathfinding', summary: 'Summary', tone: 'Technical', audience: 'Developers', domain: 'Games',
      translationStyle: ['clear', null, 2],
      terminology: [{ source: 'A*', target: null }, { source: 'heuristic', target: 123 }, { source: null, target: 'x' }],
      namedEntities: [{ source: 'Red Blob', preferredForm: null }],
    })).toMatchObject({
      translationStyle: ['clear', '2'],
      terminology: [
        { source: 'A*', target: 'A*', keepOriginal: true },
        { source: 'heuristic', target: '123' },
      ],
      namedEntities: [{ source: 'Red Blob', preferredForm: 'Red Blob' }],
    })
  })
})
