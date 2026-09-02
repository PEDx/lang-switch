import { createExactPathnamePattern } from './site-rule-utils'

describe('site rule pathname', () => {
  it('limits a rule to the current path and escapes regular expression characters', () => {
    const pattern = createExactPathnamePattern('/pathfinding/a-star/introduction.html')
    expect(new RegExp(pattern).test('/pathfinding/a-star/introduction.html')).toBe(true)
    expect(new RegExp(pattern).test('/pathfinding/heuristics.html')).toBe(false)

    const escaped = createExactPathnamePattern('/articles/v1.0/(draft)')
    expect(new RegExp(escaped).test('/articles/v1.0/(draft)')).toBe(true)
    expect(new RegExp(escaped).test('/articles/v1x0/draft')).toBe(false)
  })
})
