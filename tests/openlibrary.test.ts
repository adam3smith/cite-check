import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchByTitleAuthor } from '../src/api/openlibrary'
import type { ParsedReference } from '../src/types'

function makeRef(overrides: Partial<ParsedReference> = {}): ParsedReference {
  return {
    index: 0,
    raw: '',
    type: 'book',
    parseConfidence: 'high',
    authors: [],
    year: null,
    title: null,
    container: null,
    doi: null,
    url: null,
    isbn: null,
    pages: null,
    volume: null,
    issue: null,
    ...overrides,
  }
}

function mockFetch(docs: object[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ docs }),
    }),
  )
}

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.unstubAllGlobals())

// ── Publisher selection ───────────────────────────────────────────────────────

describe('openlibrary searchByTitleAuthor — publisher selection', () => {
  it('picks the publisher that best matches ref.container when multiple are returned', async () => {
    const ref = makeRef({
      title: 'Polarized and Demobilized',
      container: 'Oxford University Press',
      authors: [{ last: 'El Kurd', first: 'Dana' }],
      year: '2020',
    })

    mockFetch([
      {
        title: 'Polarized and Demobilized',
        author_name: ['Dana El Kurd'],
        first_publish_year: 2019,
        publisher: [
          'C. Hurst and Company (Publishers) Limited',
          'Oxford University Press, Incorporated',
          'Oxford University Press',
        ],
        isbn: ['9780190095864'],
      },
    ])

    const result = await searchByTitleAuthor(ref)
    expect(result.lookupStatus).toBe('found')
    expect(result.apiData?.container).toContain('Oxford')
  })

  it('falls back to first publisher when ref has no container', async () => {
    const ref = makeRef({
      title: 'Some Book',
      authors: [{ last: 'Smith', first: 'John' }],
    })

    mockFetch([
      {
        title: 'Some Book',
        author_name: ['John Smith'],
        first_publish_year: 2010,
        publisher: ['First Publisher', 'Second Publisher'],
      },
    ])

    const result = await searchByTitleAuthor(ref)
    expect(result.apiData?.container).toBe('First Publisher')
  })
})

// ── Particle parsing ──────────────────────────────────────────────────────────

describe('openlibrary searchByTitleAuthor — author particle parsing', () => {
  it('parses "el" particle: "Dana El Kurd" → last="El Kurd"', async () => {
    // Regression: "el" was missing from PARTICLES, yielding last="Kurd", author score=0
    const ref = makeRef({
      title: 'Polarized and Demobilized',
      authors: [{ last: 'El Kurd', first: 'Dana' }],
    })

    mockFetch([
      {
        title: 'Polarized and Demobilized',
        author_name: ['Dana El Kurd'],
        first_publish_year: 2020,
        publisher: ['Oxford University Press'],
      },
    ])

    const result = await searchByTitleAuthor(ref)
    expect(result.apiData?.authors[0]?.last).toBe('El Kurd')
    expect(result.apiData?.authors[0]?.first).toBe('Dana')
  })

  it('parses "al" particle: "Bassem Al Oudat" → last="Al Oudat"', async () => {
    const ref = makeRef({
      title: 'Some Title',
      authors: [{ last: 'Al Oudat', first: 'Bassem' }],
    })

    mockFetch([
      {
        title: 'Some Title',
        author_name: ['Bassem Al Oudat'],
        first_publish_year: 2021,
        publisher: ['Some Press'],
      },
    ])

    const result = await searchByTitleAuthor(ref)
    expect(result.apiData?.authors[0]?.last).toBe('Al Oudat')
  })

  it('parses "de" particle: "Catherine De Vries" → last="De Vries"', async () => {
    const ref = makeRef({
      title: 'Euroscepticism and the Future',
      authors: [{ last: 'De Vries', first: 'Catherine' }],
    })

    mockFetch([
      {
        title: 'Euroscepticism and the Future',
        author_name: ['Catherine De Vries'],
        first_publish_year: 2018,
        publisher: ['Oxford University Press'],
      },
    ])

    const result = await searchByTitleAuthor(ref)
    expect(result.apiData?.authors[0]?.last).toBe('De Vries')
  })
})
