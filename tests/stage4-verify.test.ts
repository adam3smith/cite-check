import { describe, it, expect } from 'vitest'
import { findDiscrepancies } from '../src/stages/stage4-verify'
import type { LookupResult, NormalizedWork } from '../src/types'
import { scoreReference, weightedTotal, scoreToStatus } from '../src/lib/string-distance'

// Helper to build a minimal LookupResult for testing
function makeLookup(overrides: Partial<LookupResult> = {}): LookupResult {
  return {
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
    lookupStatus: 'found',
    lookupSource: 'crossref-search',
    apiData: null,
    ...overrides,
  }
}

function makeApiData(overrides: Partial<NormalizedWork> = {}): NormalizedWork {
  return {
    title: 'Increasing Returns, Path Dependence, and the Study of Politics',
    authors: [{ last: 'Pierson', first: 'Paul' }],
    year: '2000',
    container: 'American Political Science Review',
    doi: '10.2307/2586011',
    isbn: null,
    pages: '251-267',
    volume: '94',
    issue: '2',
    url: null,
    type: 'journal-article',
    raw: {},
    ...overrides,
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

describe('scoreReference + weightedTotal (perfect match)', () => {
  it('returns near-perfect score for matching reference', () => {
    const lookup = makeLookup({ apiData: makeApiData() })
    const scores = scoreReference(lookup, lookup.apiData!)
    const total = weightedTotal(scores)
    expect(total).toBeGreaterThan(0.9)
    expect(scores.year).toBe(1)
    expect(scores.author).toBeGreaterThan(0.95)
    expect(scores.title).toBeGreaterThan(0.95)
  })

  it('gives 0.5 for year ±1 (online-first lag) — partial penalty, still close to verified', () => {
    const lookup = makeLookup()
    // 2000 vs 1999: off by 1 → year score 0.5 (costs 0.075 instead of 0.15 full penalty)
    const scores = scoreReference(lookup, makeApiData({ year: '1999' }))
    expect(scores.year).toBe(0.5)
    // With all other fields perfect, total is ~0.925 — still "verified" but below perfect 1.0
    expect(weightedTotal(scores)).toBeLessThan(1.0)
    expect(weightedTotal(scores)).toBeGreaterThan(0.85)
  })

  it('gives 0 for year ±2 or more', () => {
    const lookup = makeLookup()
    const scores = scoreReference(lookup, makeApiData({ year: '1998' }))
    expect(scores.year).toBe(0)
    expect(weightedTotal(scores)).toBeLessThan(0.9)
  })

  it('penalizes wrong author heavily', () => {
    const lookup = makeLookup()
    const api = makeApiData({ authors: [{ last: 'North', first: 'Douglass' }] })
    const scores = scoreReference(lookup, api)
    expect(scores.author).toBeLessThan(0.7)
    expect(weightedTotal(scores)).toBeLessThan(0.9)
  })

  it('penalizes wrong title heavily', () => {
    const lookup = makeLookup()
    const api = makeApiData({ title: 'Institutions and Institutional Change' })
    const scores = scoreReference(lookup, api)
    expect(scores.title).toBeLessThan(0.8)
  })
})

// ── verificationStatus thresholds ────────────────────────────────────────────

describe('scoreToStatus thresholds', () => {
  it('verified ≥ 0.90', () => {
    expect(scoreToStatus(0.92, 'found')).toBe('verified')
    expect(scoreToStatus(0.90, 'found')).toBe('verified')
  })
  it('likely-match 0.70–0.89', () => {
    expect(scoreToStatus(0.80, 'found')).toBe('likely-match')
    expect(scoreToStatus(0.70, 'found')).toBe('likely-match')
  })
  it('weak-match 0.50–0.69', () => {
    expect(scoreToStatus(0.60, 'found')).toBe('weak-match')
  })
  it('not-found < 0.50', () => {
    expect(scoreToStatus(0.40, 'found')).toBe('not-found')
  })
  it('not-found when lookupStatus is not-found regardless of score', () => {
    expect(scoreToStatus(0.99, 'not-found')).toBe('not-found')
  })
  it('unverifiable when lookupStatus is unverifiable', () => {
    expect(scoreToStatus(0.0, 'unverifiable')).toBe('unverifiable')
  })
})

// ── findDiscrepancies ─────────────────────────────────────────────────────────

describe('findDiscrepancies', () => {
  it('returns no discrepancies for perfect match', () => {
    const api = makeApiData()
    const lookup = makeLookup({ apiData: api })
    const scores = scoreReference(lookup, api)
    const discs = findDiscrepancies(lookup, scores)
    expect(discs).toHaveLength(0)
  })

  it('returns minor discrepancy for year ±1 (online-first lag)', () => {
    const api = makeApiData({ year: '1999' })
    const lookup = makeLookup({ apiData: api })
    const scores = scoreReference(lookup, api)
    const discs = findDiscrepancies(lookup, scores)
    const yearDisc = discs.find((d) => d.field === 'year')
    expect(yearDisc).toBeDefined()
    expect(yearDisc?.severity).toBe('minor')
    expect(yearDisc?.input).toBe('2000')
    expect(yearDisc?.found).toBe('1999')
  })

  it('returns major discrepancy for year ±2 or more', () => {
    const api = makeApiData({ year: '1998' })
    const lookup = makeLookup({ apiData: api })
    const scores = scoreReference(lookup, api)
    const discs = findDiscrepancies(lookup, scores)
    const yearDisc = discs.find((d) => d.field === 'year')
    expect(yearDisc).toBeDefined()
    expect(yearDisc?.severity).toBe('major')
    expect(yearDisc?.input).toBe('2000')
    expect(yearDisc?.found).toBe('1998')
  })

  it('returns major discrepancy for wrong author', () => {
    const api = makeApiData({ authors: [{ last: 'North', first: 'Douglass' }] })
    const lookup = makeLookup({ apiData: api })
    const scores = scoreReference(lookup, api)
    const discs = findDiscrepancies(lookup, scores)
    const authorDisc = discs.find((d) => d.field === 'author')
    expect(authorDisc).toBeDefined()
    expect(authorDisc?.severity).toBe('major')
  })

  it('returns minor discrepancy for hyphen vs en-dash in pages', () => {
    // '251–267' (en-dash) vs '251-267' (hyphen) — high Jaro-Winkler, minor
    const api = makeApiData({ pages: '251-267' })
    const lookup = makeLookup({ apiData: api })
    const scores = scoreReference(lookup, api)
    const discs = findDiscrepancies(lookup, scores)
    const pagesDisc = discs.find((d) => d.field === 'pages')
    // Either no discrepancy (score ≥ 0.95) or minor
    if (pagesDisc) {
      expect(pagesDisc.severity).toBe('minor')
    }
  })

  it('returns empty array when apiData is null', () => {
    const lookup = makeLookup({ apiData: null, lookupStatus: 'not-found' })
    const scores = { author: 0, title: 0, year: 0, container: 0, pages: 0 }
    expect(findDiscrepancies(lookup, scores)).toHaveLength(0)
  })
})
