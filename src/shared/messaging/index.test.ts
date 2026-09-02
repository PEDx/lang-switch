import { messageSchema } from '.'

describe('translation render messages', () => {
  it('validates a correlated batch render request', () => {
    const parsed = messageSchema.safeParse({
      type: 'RENDER_TRANSLATIONS',
      translations: [{
        segmentId: 'segment-1',
        translatedText: '译文',
        segment: {
          id: 'segment-1', tagName: 'p', sourceText: 'Source',
          elementPath: 'article > p', order: 0,
        },
      }],
      showToolbar: true,
      mode: 'bilingual',
      opacity: 0.32,
      translationStyle: 'highlight',
      translationLineHeight: null,
      translationFont: 'serif',
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects an invalid display mode in a batch render request', () => {
    expect(messageSchema.safeParse({
      type: 'RENDER_TRANSLATIONS',
      translations: [],
      mode: 'hidden',
      opacity: 0.32,
    }).success).toBe(false)
  })

  it('accepts a request to restore automatic article detection', () => {
    expect(messageSchema.safeParse({ type: 'RESET_ARTICLE_REGION' }).success).toBe(true)
  })

  it('validates explicit confirmation for a partial article translation', () => {
    expect(messageSchema.safeParse({
      type: 'START_TRANSLATION',
      tabId: 1,
      allowPartialRegion: true,
    }).success).toBe(true)
    expect(messageSchema.safeParse({
      type: 'START_TRANSLATION',
      allowPartialRegion: 'yes',
    }).success).toBe(false)
  })
})
