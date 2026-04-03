import { describe, it, expect, vi, beforeEach } from 'vitest'
import { lookupReference } from '../src/stages/stage3-lookup'
import * as crossref from '../src/api/crossref'
import * as openalex from '../src/api/openalex'
import * as openlibrary from '../src/api/openlibrary'
import * as googlebooks from '../src/api/googlebooks'
import type { ParsedReference, LookupResult, NormalizedWork } from '../src/types'

// Bypass rate-limiter delays so tests run instantly
vi.mock('../src/lib/rate-limiter', () => ({
  rateLimited: (_domain: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('../src/api/crossref')
vi.mock('../src/api/openalex')
vi.mock('../src/api/openlibrary')
vi.mock('../src/api/googlebooks')
vi.mock('../src/api/url-check')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRef(overrides: Partial<ParsedReference> = {}): ParsedReference {
  return {
    index: 0,
    raw: 'Litton, Noah. 2012. "The Road to Better Redistricting." Ohio St. LJ 73 : 839.',
    type: 'other',
    parseConfidence: 'low',
    authors: [{ last: 'Litton', first: 'Noah' }],
    year: '2012',
    title: 'The Road to Better Redistricting',
    container: 'Ohio St. LJ',
    doi: null,
    url: null,
    isbn: null,
    pages: '839',
    volume: '73',
    issue: null,
    ...overrides,
  }
}

/**
 * API data whose fields closely match makeRef() — weighted score well above 0.65.
 * author=1.0 (0.30) + title=1.0 (0.40) + year=1.0 (0.15) + container≈1 (0.10) + pages=1.0 (0.05) ≈ 1.0
 */
function goodMatch(): NormalizedWork {
  return {
    title: 'The Road to Better Redistricting',
    authors: [{ last: 'Litton', first: 'Noah' }],
    year: '2012',
    container: 'Ohio St. LJ',
    doi: null,
    isbn: null,
    pages: '839',
    volume: '73',
    issue: null,
    url: null,
    type: 'journal-article',
    raw: {},
  }
}

/**
 * API data with completely different author and title — weighted score ~0.15.
 * author=0 (0.30) + title=0 (0.40) + year=1.0 (0.15) + container≈0 (0.10) + pages=0 (0.05) = 0.15
 * This is well below the MIN_ACCEPT_SCORE of 0.65.
 */
function badMatch(): NormalizedWork {
  return {
    title: 'Ballot Access Laws and Independent Candidates',
    authors: [{ last: 'Bork', first: 'Peter' }],
    year: '2012',
    container: 'Harvard Law Review',
    doi: null,
    isbn: null,
    pages: null,
    volume: null,
    issue: null,
    url: null,
    type: 'journal-article',
    raw: {},
  }
}

function found(ref: ParsedReference, source: LookupResult['lookupSource'], data: NormalizedWork): LookupResult {
  return { ...ref, lookupStatus: 'found', lookupSource: source, apiData: data }
}

function notFound(ref: ParsedReference, source: LookupResult['lookupSource']): LookupResult {
  return { ...ref, lookupStatus: 'not-found', lookupSource: source, apiData: null }
}

// ── lookupOther (fixes for issues #1 and #2) ─────────────────────────────────
//
// References that can't be classified (law journal cites without vol(issue) format,
// books from non-"press" imprints like Crown) fall to type="other". Before the fix,
// the default case returned CrossRef's result unconditionally — even a 61% match.
// Now lookupOther checks each API's score against MIN_ACCEPT_SCORE (0.65) and tries
// CrossRef → OpenAlex → Google Books → OpenLibrary in sequence.

describe('lookupOther — type = "other"', () => {
  let ref: ParsedReference

  beforeEach(() => {
    ref = makeRef({ type: 'other' })
    vi.resetAllMocks()
    // Default all APIs to not-found so individual tests only set what they need
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(notFound(ref, 'crossref-search'))
    vi.mocked(openalex.searchByTitleAuthor).mockResolvedValue(notFound(ref, 'openalex'))
    vi.mocked(googlebooks.searchByTitleAuthor).mockResolvedValue(notFound(ref, 'google-books'))
    vi.mocked(openlibrary.searchByTitleAuthor).mockResolvedValue(notFound(ref, 'openlibrary'))
  })

  it('returns CrossRef result immediately when its score is above threshold', async () => {
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(found(ref, 'crossref-search', goodMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.lookupSource).toBe('crossref-search')
    expect(openalex.searchByTitleAuthor).not.toHaveBeenCalled()
  })

  it('regression: does NOT return a below-threshold CrossRef result (was returning 61% match)', async () => {
    // The old default case returned whatever CrossRef found, no score check.
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(found(ref, 'crossref-search', badMatch()))
    vi.mocked(openalex.searchByTitleAuthor).mockResolvedValue(notFound(ref, 'openalex'))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('not-found')
    expect(result.apiData).toBeNull()
  })

  it('falls through to OpenAlex when CrossRef score is below threshold', async () => {
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(found(ref, 'crossref-search', badMatch()))
    vi.mocked(openalex.searchByTitleAuthor).mockResolvedValue(found(ref, 'openalex', goodMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.lookupSource).toBe('openalex')
  })

  it('falls through to Google Books when CrossRef and OpenAlex are below threshold', async () => {
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(found(ref, 'crossref-search', badMatch()))
    vi.mocked(openalex.searchByTitleAuthor).mockResolvedValue(found(ref, 'openalex', badMatch()))
    vi.mocked(googlebooks.searchByTitleAuthor).mockResolvedValue(found(ref, 'google-books', goodMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.lookupSource).toBe('google-books')
  })

  it('falls through to OpenLibrary when CrossRef, OpenAlex, and Google Books are below threshold', async () => {
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(found(ref, 'crossref-search', badMatch()))
    vi.mocked(openalex.searchByTitleAuthor).mockResolvedValue(found(ref, 'openalex', badMatch()))
    vi.mocked(googlebooks.searchByTitleAuthor).mockResolvedValue(found(ref, 'google-books', badMatch()))
    vi.mocked(openlibrary.searchByTitleAuthor).mockResolvedValue(found(ref, 'openlibrary', goodMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.lookupSource).toBe('openlibrary')
  })

  it('returns not-found when all four APIs are below threshold', async () => {
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(found(ref, 'crossref-search', badMatch()))
    vi.mocked(openalex.searchByTitleAuthor).mockResolvedValue(found(ref, 'openalex', badMatch()))
    vi.mocked(googlebooks.searchByTitleAuthor).mockResolvedValue(found(ref, 'google-books', badMatch()))
    vi.mocked(openlibrary.searchByTitleAuthor).mockResolvedValue(found(ref, 'openlibrary', badMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('not-found')
    expect(result.lookupSource).toBeNull()
    expect(result.apiData).toBeNull()
  })
})

// ── DOI fallback to OpenAlex (fix for issue #3) ───────────────────────────────
//
// When a reference has a DOI that CrossRef doesn't know (e.g. Harvard Dataverse,
// Zenodo), the old code returned not-found immediately. Now it tries OpenAlex
// before giving up, then falls through to title+author search if both DOI
// lookups fail.

describe('lookupJournalArticle — DOI path', () => {
  let ref: ParsedReference

  beforeEach(() => {
    ref = makeRef({
      type: 'journal-article',
      doi: '10.7910/DVN/SLCD3E',
      title: 'Simulated redistricting plans for the 2010 redistricting cycle',
      authors: [{ last: 'Kenny', first: 'Christopher T' }],
      container: null,
    })
    vi.resetAllMocks()
    // Defaults — can be overridden per test
    vi.mocked(crossref.lookupByDOI).mockResolvedValue(notFound(ref, 'crossref-doi'))
    vi.mocked(openalex.lookupByDOI).mockResolvedValue(notFound(ref, 'openalex-doi'))
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(notFound(ref, 'crossref-search'))
    vi.mocked(openalex.searchByTitleAuthor).mockResolvedValue(notFound(ref, 'openalex'))
  })

  it('returns CrossRef DOI result when CrossRef has the DOI', async () => {
    vi.mocked(crossref.lookupByDOI).mockResolvedValue(found(ref, 'crossref-doi', goodMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.lookupSource).toBe('crossref-doi')
    expect(openalex.lookupByDOI).not.toHaveBeenCalled()
  })

  it('tries OpenAlex DOI when CrossRef does not have the DOI', async () => {
    vi.mocked(crossref.lookupByDOI).mockResolvedValue(notFound(ref, 'crossref-doi'))
    vi.mocked(openalex.lookupByDOI).mockResolvedValue(found(ref, 'openalex-doi', goodMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.lookupSource).toBe('openalex-doi')
  })

  it('falls through to title+author search when both DOI lookups fail', async () => {
    vi.mocked(crossref.lookupByDOI).mockResolvedValue(notFound(ref, 'crossref-doi'))
    vi.mocked(openalex.lookupByDOI).mockResolvedValue(notFound(ref, 'openalex-doi'))
    vi.mocked(crossref.searchByTitleAuthor).mockResolvedValue(found(ref, 'crossref-search', goodMatch()))
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.lookupSource).toBe('crossref-search')
    expect(crossref.searchByTitleAuthor).toHaveBeenCalled()
  })

  it('returns not-found when DOI lookups and title+author search all fail', async () => {
    // All mocks return not-found (set in beforeEach)
    const result = await lookupReference(ref)
    expect(result.lookupStatus).toBe('not-found')
    expect(result.apiData).toBeNull()
  })
})
