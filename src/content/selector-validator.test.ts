import standardArticle from '../test/fixtures/standard-article.html?raw'
import { validateCssSelector } from './selector-validator'

describe('CSS selector validation', () => {
  beforeEach(() => { document.documentElement.innerHTML = standardArticle })

  it('rejects invalid and missing selectors', () => {
    expect(validateCssSelector('article[').message).toContain('不合法')
    expect(validateCssSelector('.missing').matchCount).toBe(0)
  })

  it('rejects multiple matches and small regions', () => {
    expect(validateCssSelector('p').matchCount).toBe(6)
    expect(validateCssSelector('nav').valid).toBe(false)
  })

  it('accepts one visible article with enough text', () => {
    const result = validateCssSelector('#post')
    expect(result.valid).toBe(true)
    expect(result.paragraphCount).toBeGreaterThan(5)
  })
})
