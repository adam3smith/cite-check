import { describe, it, expect } from 'vitest'
import {
  jaro,
  jaroWinkler,
  fieldScore,
  firstNameScore,
  titleFieldScore,
  tokenJaccard,
  scoreReference,
  weightedTotal,
  scoreToStatus,
  normalizeForComparison,
  normalizePublisher,
  expandPageRange,
} from '../src/lib/string-distance'
import type { ParsedReference, NormalizedWork } from '../src/types'

// ── jaro ──────────────────────────────────────────────────────────────────────

describe('jaro', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaro('hello', 'hello')).toBe(1)
  })
  it('returns 0.0 for completely different strings', () => {
    expect(jaro('abc', 'xyz')).toBe(0)
  })
  it('returns 0.0 for empty string', () => {
    expect(jaro('', 'hello')).toBe(0)
    expect(jaro('hello', '')).toBe(0)
  })
  it('scores "MARTHA" vs "MARHTA" close to 0.94', () => {
    // Classic Jaro test case
    expect(jaro('MARTHA', 'MARHTA')).toBeCloseTo(0.944, 2)
  })
  it('scores "DIXON" vs "DICKSONX" below 0.85', () => {
    expect(jaro('DIXON', 'DICKSONX')).toBeLessThan(0.85)
  })
})

// ── jaroWinkler ───────────────────────────────────────────────────────────────

describe('jaroWinkler', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1)
  })
  it('scores strings with common prefix higher than jaro', () => {
    const s1 = 'MARTHA'
    const s2 = 'MARHTA'
    expect(jaroWinkler(s1, s2)).toBeGreaterThanOrEqual(jaro(s1, s2))
  })
  it('scores "American Economic Review" vs "Amer. Econ. Rev." above 0.75', () => {
    expect(jaroWinkler('american economic review', 'amer econ rev')).toBeGreaterThan(0.75)
  })
})

// ── normalizePublisher ────────────────────────────────────────────────────────

describe('normalizePublisher', () => {
  it('strips city prefix from "City: Publisher"', () => {
    expect(normalizePublisher('New York: Crown')).toBe('Crown')
  })
  it('strips city+state prefix', () => {
    expect(normalizePublisher('Cambridge, MA: Harvard University Press')).toBe('Harvard University Press')
  })
  it('leaves plain publisher names unchanged', () => {
    expect(normalizePublisher('Princeton University Press')).toBe('Princeton University Press')
  })
  it('returns null for null input', () => {
    expect(normalizePublisher(null)).toBeNull()
  })
})

// ── normalizeForComparison ────────────────────────────────────────────────────

describe('normalizeForComparison', () => {
  it('lowercases', () => {
    expect(normalizeForComparison('HELLO')).toBe('hello')
  })
  it('strips curly quotes', () => {
    expect(normalizeForComparison('\u201cHello\u201d')).toBe('hello')
  })
  it('replaces punctuation with spaces and collapses them', () => {
    // comma+space → space+space → collapsed to single space
    expect(normalizeForComparison('hello, world!')).toBe('hello world')
  })
  it('collapses internal whitespace and trims', () => {
    expect(normalizeForComparison('  a   b  ')).toBe('a b')
  })
})

// ── fieldScore ────────────────────────────────────────────────────────────────

describe('fieldScore', () => {
  it('returns 1.0 for identical strings', () => {
    expect(fieldScore('Pierson', 'Pierson')).toBe(1)
  })
  it('returns 0.0 for null inputs', () => {
    expect(fieldScore(null, 'Pierson')).toBe(0)
    expect(fieldScore('Pierson', null)).toBe(0)
  })
  it('scores near-identical titles above 0.9', () => {
    const a = 'Increasing Returns, Path Dependence, and the Study of Politics'
    const b = 'Increasing Returns Path Dependence and the Study of Politics'
    expect(fieldScore(a, b)).toBeGreaterThan(0.9)
  })
  it('scores completely different values near 0', () => {
    expect(fieldScore('Smith', 'Jones')).toBeLessThan(0.6)
  })
})

// ── tokenJaccard ─────────────────────────────────────────────────────────────

describe('tokenJaccard', () => {
  it('returns 1.0 for identical strings', () => {
    expect(tokenJaccard('increasing returns path dependence', 'increasing returns path dependence')).toBe(1)
  })
  it('returns 0.0 for completely different strings', () => {
    expect(tokenJaccard('cognitive model depression political', 'multilevel facets longitudinal data')).toBe(0)
  })
  it('scores overlapping token sets proportionally', () => {
    // 2 shared tokens out of 5 union tokens
    const score = tokenJaccard('foo bar baz', 'foo bar qux quux')
    expect(score).toBeCloseTo(2 / 5, 2)
  })
})

// ── titleFieldScore ───────────────────────────────────────────────────────────

describe('titleFieldScore', () => {
  it('scores identical titles at 1.0', () => {
    const t = 'Increasing Returns, Path Dependence, and the Study of Politics'
    expect(titleFieldScore(t, t)).toBe(1)
  })

  it('scores near-identical titles (punctuation diff) above 0.9', () => {
    const a = 'Increasing Returns, Path Dependence, and the Study of Politics'
    const b = 'Increasing Returns Path Dependence and the Study of Politics'
    expect(titleFieldScore(a, b)).toBeGreaterThan(0.9)
  })

  it('scores completely different titles (Chung vs Hung regression) below 0.6', () => {
    // This is the case that motivated the fix: CrossRef search returned the wrong paper
    // and JW alone scored the titles ~0.82 (both long, share "The", "multilevel", "model")
    const input = 'The impact of ignoring multiple membership data structures in multilevel models'
    const found = 'The Generalized Multilevel Facets Model for Longitudinal Data'
    expect(titleFieldScore(input, found)).toBeLessThan(0.6)
  })

  it('scores main-title-only match (subtitle truncation) at 0.92', () => {
    // OpenLibrary often returns only the main title without subtitle
    const full = 'Tyranny of the Minority: Why American Democracy Reached the Breaking Point'
    const mainOnly = 'Tyranny of the Minority'
    expect(titleFieldScore(full, mainOnly)).toBe(0.92)
    expect(titleFieldScore(mainOnly, full)).toBe(0.92) // symmetric
  })

  it('returns 0 for null inputs', () => {
    expect(titleFieldScore(null, 'some title')).toBe(0)
  })
})

// ── scoreReference ────────────────────────────────────────────────────────────

describe('scoreReference', () => {
  const parsed: ParsedReference = {
    index: 0,
    raw: '',
    type: 'journal-article',
    parseConfidence: 'high',
    authors: [{ last: 'Pierson', first: 'Paul' }],
    year: '2000',
    title: 'Increasing Returns, Path Dependence, and the Study of Politics',
    container: 'American Political Science Review',
    doi: null,
    url: null,
    isbn: null,
    pages: '251–267',
    volume: '94',
    issue: '2',
  }

  const apiData: NormalizedWork = {
    title: 'Increasing Returns, Path Dependence, and the Study of Politics',
    authors: [{ last: 'Pierson', first: 'Paul' }],
    year: '2000',
    container: 'American Political Science Review',
    doi: null,
    isbn: null,
    pages: '251-267',
    volume: '94',
    issue: '2',
    url: null,
    type: 'journal-article',
    raw: {},
  }

  it('returns perfect scores for matching reference', () => {
    const scores = scoreReference(parsed, apiData)
    expect(scores.author).toBeGreaterThan(0.95)
    expect(scores.title).toBeGreaterThan(0.95)
    expect(scores.year).toBe(1)
    expect(scores.container).toBeGreaterThan(0.9)
  })

  it('returns 0.7 for year ±1 (online-first lag)', () => {
    expect(scoreReference(parsed, { ...apiData, year: '1999' }).year).toBe(0.7)
    expect(scoreReference(parsed, { ...apiData, year: '2001' }).year).toBe(0.7)
  })

  it('returns 0 for year ±2 or more', () => {
    expect(scoreReference(parsed, { ...apiData, year: '1998' }).year).toBe(0)
    expect(scoreReference(parsed, { ...apiData, year: '2005' }).year).toBe(0)
  })

  it('penalizes wrong author', () => {
    const badApi = { ...apiData, authors: [{ last: 'Smith', first: 'John' }] }
    expect(scoreReference(parsed, badApi).author).toBeLessThan(0.7)
  })

  it('penalizes a different full first name behind a matching last name (same-surname mismatch)', () => {
    // Real case: a citation's DOI resolves to a different paper by a different "Liu" and
    // a different "Shiraito" — same surnames, different people. Last-name-only scoring
    // used to call this a perfect 1.0 author match.
    const sameSurnameDifferentPerson = {
      ...apiData,
      authors: [
        { last: 'Liu', first: 'Guoer' },
        { last: 'Shiraito', first: 'Yuki' },
      ],
    }
    const citedAuthors: ParsedReference = {
      ...parsed,
      authors: [
        { last: 'Liu', first: 'Liyang' },
        { last: 'Shiraito', first: 'Hirokazu' },
      ],
    }
    const score = scoreReference(citedAuthors, sameSurnameDifferentPerson).author
    expect(score).toBeLessThan(0.8) // must read as at least a "major" discrepancy, not near-perfect
  })
})

// ── firstNameScore ────────────────────────────────────────────────────────────

describe('firstNameScore', () => {
  it('returns 1 for an exact match', () => {
    expect(firstNameScore('John', 'John')).toBe(1)
  })
  it('returns 1 when either side is missing (nothing to compare)', () => {
    expect(firstNameScore(null, 'John')).toBe(1)
    expect(firstNameScore('John', null)).toBe(1)
  })
  it('does not penalize an initial vs. the matching full first name', () => {
    expect(firstNameScore('J.', 'John')).toBe(1)
    expect(firstNameScore('J', 'John')).toBe(1)
  })
  it('does not penalize a run of initials vs. a full first name sharing the first letter', () => {
    expect(firstNameScore('J.M.', 'John')).toBe(1)
  })
  it('penalizes an initial that disagrees with the full name\'s first letter', () => {
    expect(firstNameScore('J.', 'Karen')).toBeLessThan(1)
  })
  it('penalizes two clearly different full first names', () => {
    expect(firstNameScore('Liyang', 'Guoer')).toBeLessThan(0.7)
    expect(firstNameScore('Hirokazu', 'Yuki')).toBeLessThan(0.7)
  })
  it('does not penalize minor spelling/typo differences between full names', () => {
    expect(firstNameScore('Katherine', 'Catherine')).toBeGreaterThan(0.8)
  })
})

// ── expandPageRange ───────────────────────────────────────────────────────────

describe('expandPageRange', () => {
  it('expands 3-digit Chicago range: 529–45 → 529-545', () => {
    expect(expandPageRange('529–45')).toBe('529-545')
  })
  it('expands 3-digit Chicago range: 849–63 → 849-863', () => {
    expect(expandPageRange('849–63')).toBe('849-863')
  })
  it('expands 4-digit Chicago range: 1369–401 → 1369-1401', () => {
    expect(expandPageRange('1369–401')).toBe('1369-1401')
  })
  it('leaves full range unchanged: 529-545', () => {
    expect(expandPageRange('529-545')).toBe('529-545')
  })
  it('leaves single page unchanged: 191', () => {
    expect(expandPageRange('191')).toBe('191')
  })
  it('scores Chicago abbreviated range equal to full range', () => {
    // pagesScore is tested via scoreReference: pages field on otherwise perfect match
    const ref = { pages: '529–45' } as { pages: string }
    const api = { pages: '529-545' } as { pages: string }
    expect(expandPageRange(ref.pages)).toBe(expandPageRange(api.pages))
  })
})

// ── weightedTotal ─────────────────────────────────────────────────────────────

describe('weightedTotal', () => {
  it('returns 1.0 for all-perfect scores', () => {
    expect(weightedTotal({ author: 1, title: 1, year: 1, container: 1, pages: 1 })).toBe(1)
  })
  it('returns 0.0 for all-zero scores', () => {
    expect(weightedTotal({ author: 0, title: 0, year: 0, container: 0, pages: 0 })).toBe(0)
  })
  it('weights title most heavily', () => {
    // title 1.0, everything else 0.0 → 0.40
    expect(weightedTotal({ author: 0, title: 1, year: 0, container: 0, pages: 0 })).toBeCloseTo(0.4)
    // author 1.0, everything else 0.0 → 0.30
    expect(weightedTotal({ author: 1, title: 0, year: 0, container: 0, pages: 0 })).toBeCloseTo(0.3)
  })
})

// ── scoreToStatus ─────────────────────────────────────────────────────────────

describe('scoreToStatus', () => {
  it('verified for score >= 0.90', () => {
    expect(scoreToStatus(0.95, 'found')).toBe('verified')
    expect(scoreToStatus(0.90, 'found')).toBe('verified')
  })
  it('likely-match for 0.70–0.89', () => {
    expect(scoreToStatus(0.85, 'found')).toBe('likely-match')
    expect(scoreToStatus(0.70, 'found')).toBe('likely-match')
  })
  it('weak-match for 0.50–0.69', () => {
    expect(scoreToStatus(0.65, 'found')).toBe('weak-match')
    expect(scoreToStatus(0.50, 'found')).toBe('weak-match')
  })
  it('not-found for score < 0.50', () => {
    expect(scoreToStatus(0.3, 'found')).toBe('not-found')
  })
  it('not-found when lookupStatus is not-found', () => {
    expect(scoreToStatus(0.99, 'not-found')).toBe('not-found')
  })
  it('unverifiable when lookupStatus is unverifiable', () => {
    expect(scoreToStatus(0.99, 'unverifiable')).toBe('unverifiable')
  })

  describe('journal-article likely-match threshold (0.80 instead of 0.70)', () => {
    it('weak-match for 0.70–0.79 when type is journal-article', () => {
      expect(scoreToStatus(0.79, 'found', 'journal-article')).toBe('weak-match')
      expect(scoreToStatus(0.70, 'found', 'journal-article')).toBe('weak-match')
    })
    it('likely-match for 0.80–0.89 when type is journal-article', () => {
      expect(scoreToStatus(0.85, 'found', 'journal-article')).toBe('likely-match')
      expect(scoreToStatus(0.80, 'found', 'journal-article')).toBe('likely-match')
    })
    it('verified for score >= 0.90 regardless of type', () => {
      expect(scoreToStatus(0.90, 'found', 'journal-article')).toBe('verified')
    })
    it('other reference types keep the 0.70 threshold', () => {
      expect(scoreToStatus(0.70, 'found', 'book')).toBe('likely-match')
      expect(scoreToStatus(0.70, 'found', 'book-chapter')).toBe('likely-match')
      expect(scoreToStatus(0.70, 'found')).toBe('likely-match')
    })
  })
})
