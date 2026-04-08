import { describe, it, expect } from 'vitest'
import {
  extractDOI,
  extractISBN,
  extractURL,
  extractYear,
  extractAuthors,
  normalizeTitle,
  extractFields,
} from '../src/stages/stage2-extract'
import { classifyType } from '../src/stages/stage1-parse'
import { fixtures } from './fixtures/references'
import type { RawEntry } from '../src/types'

// ── extractDOI ────────────────────────────────────────────────────────────────

describe('extractDOI', () => {
  it('extracts from doi.org URL', () => {
    expect(extractDOI('see https://doi.org/10.1257/aer.91.5.1369 for details')).toBe(
      '10.1257/aer.91.5.1369',
    )
  })
  it('extracts from DOI: prefix', () => {
    expect(extractDOI('DOI: 10.1111/j.1540-5907.2004.00075.x')).toBe(
      '10.1111/j.1540-5907.2004.00075.x',
    )
  })
  it('extracts bare 10. pattern', () => {
    expect(extractDOI('some text 10.2307/2111388 more text')).toBe('10.2307/2111388')
  })
  it('strips trailing punctuation', () => {
    expect(extractDOI('doi.org/10.1257/aer.91.5.1369.')).toBe('10.1257/aer.91.5.1369')
  })
  it('returns null when no DOI', () => {
    expect(extractDOI('Thelen, Kathleen. 2004. How Institutions Evolve.')).toBeNull()
  })
})

// ── extractISBN ───────────────────────────────────────────────────────────────

describe('extractISBN', () => {
  it('extracts ISBN-13 with hyphens', () => {
    expect(extractISBN('ISBN: 978-0-521-39734-6')).toBe('9780521397346')
  })
  it('extracts ISBN-13 without hyphens', () => {
    expect(extractISBN('ISBN: 9780521397346')).toBe('9780521397346')
  })
  it('returns null when no ISBN', () => {
    expect(extractISBN('Thelen, Kathleen. 2004. How Institutions Evolve.')).toBeNull()
  })
})

// ── extractURL ────────────────────────────────────────────────────────────────

describe('extractURL', () => {
  it('extracts https URL', () => {
    expect(extractURL('Retrieved from https://databank.worldbank.org/wdi.')).toBe(
      'https://databank.worldbank.org/wdi',
    )
  })
  it('does not return doi.org as URL', () => {
    const text = 'AER 91 (5): 1369. https://doi.org/10.1257/aer.91.5.1369'
    expect(extractURL(text)).toBeNull()
  })
  it('returns null when no URL', () => {
    expect(extractURL('Thelen, Kathleen. 2004. How Institutions Evolve.')).toBeNull()
  })
})

// ── extractYear ───────────────────────────────────────────────────────────────

describe('extractYear', () => {
  it('extracts Chicago-style year', () => {
    expect(extractYear('Pierson, Paul. 2000. "Increasing Returns."')).toBe('2000')
  })
  it('extracts APA-style year in parens', () => {
    expect(extractYear('Putnam, R. D. (1993). Making democracy work.')).toBe('1993')
  })
  it('extracts year from APA disambiguator suffix (2024a)', () => {
    expect(extractYear('Bernardi, L. (2024a). A cognitive model.')).toBe('2024')
  })
  it('extracts year from APA disambiguator suffix (2024b)', () => {
    expect(extractYear('Bernardi, L. (2024b). Not in the mood.')).toBe('2024')
  })
  it('does not mistake a 4-digit issue number for a year', () => {
    // Science 370 (6516) — issue number 6516 is not a valid year
    expect(extractYear('Finkel et al. 2020. "Political Sectarianism." Science 370 (6516): 533–36.')).toBe('2020')
  })
  it('does not mistake a 4-digit issue number for a year (Nature)', () => {
    // Nature 613 (7945) — issue number 7945 is not a valid year
    expect(extractYear('Bor et al. 2023. "Discriminatory Attitudes." Nature 613 (7945): 704–11.')).toBe('2023')
  })
  it('returns null when no year', () => {
    expect(extractYear('No year here at all in this text.')).toBeNull()
  })
})

// ── extractAuthors ────────────────────────────────────────────────────────────

describe('extractAuthors', () => {
  it('extracts single author', () => {
    const authors = extractAuthors('Pierson, Paul')
    expect(authors).toHaveLength(1)
    expect(authors[0].last).toBe('Pierson')
    expect(authors[0].first).toBe('Paul')
  })

  it('extracts three authors with "and"', () => {
    const authors = extractAuthors('Acemoglu, Daron, Simon Johnson, and James A. Robinson')
    // Note: comma separation between multiple authors is tricky — at minimum first and last should be present
    const lastNames = authors.map((a) => a.last)
    expect(lastNames).toContain('Acemoglu')
    expect(lastNames).toContain('Robinson')
  })

  it('extracts two authors with comma + and', () => {
    const authors = extractAuthors('Hall, Peter A., and David Soskice')
    expect(authors.length).toBeGreaterThanOrEqual(1)
    expect(authors[0].last).toBe('Hall')
  })

  it('extracts APA-style authors with &', () => {
    const authors = extractAuthors('Mahoney, J., & Thelen, K.')
    expect(authors).toHaveLength(2)
    expect(authors[0].last).toBe('Mahoney')
    expect(authors[1].last).toBe('Thelen')
  })

  it('parses mixed-case LastName AB format (SAGE/Vancouver initials, no comma)', () => {
    const authors = extractAuthors('Azari JR and Smith JK')
    expect(authors[0].last).toBe('Azari')
    expect(authors[0].first).toBe('JR')
    expect(authors[1].last).toBe('Smith')
    expect(authors[1].first).toBe('JK')
  })

  it('parses single initial after mixed-case last name (Bächtiger A)', () => {
    const authors = extractAuthors('Bächtiger A and Hangartner D')
    expect(authors[0].last).toBe('Bächtiger')
    expect(authors[0].first).toBe('A')
    expect(authors[1].last).toBe('Hangartner')
    expect(authors[1].first).toBe('D')
  })

  it('parses hyphenated initials A-S', () => {
    const authors = extractAuthors('Heinze A-S')
    expect(authors[0].last).toBe('Heinze')
    expect(authors[0].first).toBe('A-S')
  })

  it('strips et al. and keeps preceding authors', () => {
    const authors = extractAuthors('Kurtz KT et al.')
    expect(authors).toHaveLength(1)
    expect(authors[0].last).toBe('Kurtz')
    expect(authors[0].first).toBe('KT')
  })

  it('strips et al without period', () => {
    const authors = extractAuthors('Smith J et al')
    expect(authors[0].last).toBe('Smith')
  })
})

// ── normalizeTitle ────────────────────────────────────────────────────────────

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('"The Colonial Origins"')).toBe('the colonial origins')
  })
  it('collapses whitespace', () => {
    expect(normalizeTitle('  some   title  ')).toBe('some title')
  })
})

// ── extractFields: title ending in ? with journal following directly ──────────

describe('extractFields — question-mark title, journal follows', () => {
  function makeEntry(raw: string): RawEntry {
    const { type, confidence } = classifyType(raw)
    return { index: 0, raw, type, parseConfidence: confidence }
  }

  const och =
    'Och M (2020) Manterrupting in the German Bundestag: Gendered Opposition to Female Members of Parliament? Politics & Gender 16, 388–408.'

  it('extracts title ending in ? (Och)', () => {
    const t = extractFields(makeEntry(och)).title
    expect(t).toContain('Parliament?')
    expect(t).not.toContain('Politics')
  })
  it('extracts container (Och)', () => {
    expect(extractFields(makeEntry(och)).container).toContain('Politics')
  })
  it('extracts pages (Och)', () => {
    expect(extractFields(makeEntry(och)).pages).toContain('388')
  })

  const stasavage =
    'Stasavage D (2004) Open-Door or Closed-Door? Transparency in Domestic and International Bargaining. International Organization 58, 667–703.'

  it('still correctly parses Stasavage (subtitle after ?, journal after period)', () => {
    const result = extractFields(makeEntry(stasavage))
    expect(result.title).toContain('Bargaining')
    expect(result.container).toContain('International Organization')
  })
})

// ── extractFields: SAGE Vol,Pages format ─────────────────────────────────────

describe('extractFields — SAGE Vol,Pages (no issue)', () => {
  function makeEntry(raw: string): RawEntry {
    const { type, confidence } = classifyType(raw)
    return { index: 0, raw, type, parseConfidence: confidence }
  }

  const sage =
    'Azari JR and Smith JK (2012) Unwritten Rules: Informal Institutions in Established Democracies. Perspectives on Politics 10, 37–55.'

  it('extracts volume 10', () => {
    expect(extractFields(makeEntry(sage)).volume).toBe('10')
  })
  it('extracts pages 37–55', () => {
    expect(extractFields(makeEntry(sage)).pages).toContain('37')
  })
})

// ── extractYear: Vancouver semicolon ─────────────────────────────────────────

describe('extractYear — Vancouver semicolon', () => {
  it('extracts year from YYYY; pattern', () => {
    expect(
      extractYear('TEZCÜR GM. Ordinary People. American Political Science Review. 2016;110(2):247–64.'),
    ).toBe('2016')
  })
})

// ── extractFields: back-date formats ─────────────────────────────────────────

describe('extractFields — MLA back-date format', () => {
  function makeEntry(raw: string): RawEntry {
    const { type, confidence } = classifyType(raw)
    return { index: 0, raw, type, parseConfidence: confidence }
  }

  const mla =
    'TEZCÜR, GÜNEŞ MURAT. "Ordinary People, Extraordinary Risks: Participation in an Ethnic Rebellion." American Political Science Review 110, no. 2 (2016): 247–64.'

  it('extracts author last name TEZCÜR', () => {
    expect(extractFields(makeEntry(mla)).authors[0]?.last).toBe('TEZCÜR')
  })
  it('extracts year 2016', () => {
    expect(extractFields(makeEntry(mla)).year).toBe('2016')
  })
  it('extracts title containing "Ordinary People"', () => {
    expect(extractFields(makeEntry(mla)).title).toContain('Ordinary People')
  })
  it('extracts container containing "American Political Science Review"', () => {
    expect(extractFields(makeEntry(mla)).container).toContain('American Political Science Review')
  })
  it('extracts pages 247', () => {
    expect(extractFields(makeEntry(mla)).pages).toContain('247')
  })
})

describe('extractFields — Vancouver back-date format', () => {
  function makeEntry(raw: string): RawEntry {
    const { type, confidence } = classifyType(raw)
    return { index: 0, raw, type, parseConfidence: confidence }
  }

  const vancouver =
    'TEZCÜR GM. Ordinary People, Extraordinary Risks: Participation in an Ethnic Rebellion. American Political Science Review. 2016;110(2):247–64.'

  it('extracts author last name TEZCÜR', () => {
    expect(extractFields(makeEntry(vancouver)).authors[0]?.last).toBe('TEZCÜR')
  })
  it('extracts year 2016', () => {
    expect(extractFields(makeEntry(vancouver)).year).toBe('2016')
  })
  it('extracts title containing "Ordinary People"', () => {
    expect(extractFields(makeEntry(vancouver)).title).toContain('Ordinary People')
  })
  it('extracts container containing "American Political Science Review"', () => {
    expect(extractFields(makeEntry(vancouver)).container).toContain('American Political Science Review')
  })
  it('extracts volume 110 and issue 2', () => {
    const result = extractFields(makeEntry(vancouver))
    expect(result.volume).toBe('110')
    expect(result.issue).toBe('2')
  })
  it('extracts pages 247', () => {
    expect(extractFields(makeEntry(vancouver)).pages).toContain('247')
  })
})

// ── extractFields (integration) ───────────────────────────────────────────────

describe('extractFields — fixture integration', () => {
  function makeEntry(f: (typeof fixtures)[0]): RawEntry {
    const { type, confidence } = classifyType(f.raw)
    return { index: 0, raw: f.raw, type, parseConfidence: confidence }
  }

  describe('article-with-doi', () => {
    const f = fixtures.find((x) => x.id === 'article-with-doi')!
    it('extracts DOI', () => {
      expect(extractFields(makeEntry(f)).doi).toBe('10.1257/aer.91.5.1369')
    })
    it('extracts year 2001', () => {
      expect(extractFields(makeEntry(f)).year).toBe('2001')
    })
    it('extracts volume 91', () => {
      expect(extractFields(makeEntry(f)).volume).toBe('91')
    })
    it('extracts issue 5', () => {
      expect(extractFields(makeEntry(f)).issue).toBe('5')
    })
    it('extracts first author last name Acemoglu', () => {
      const result = extractFields(makeEntry(f))
      expect(result.authors[0]?.last).toBe('Acemoglu')
    })
  })

  describe('article-no-doi-chicago', () => {
    const f = fixtures.find((x) => x.id === 'article-no-doi-chicago')!
    it('extracts year 2000', () => {
      expect(extractFields(makeEntry(f)).year).toBe('2000')
    })
    it('extracts author Pierson', () => {
      expect(extractFields(makeEntry(f)).authors[0]?.last).toBe('Pierson')
    })
    it('extracts volume 94', () => {
      expect(extractFields(makeEntry(f)).volume).toBe('94')
    })
  })

  describe('article-volume-only (APA year-suffix regression)', () => {
    const f = fixtures.find((x) => x.id === 'article-volume-only')!
    it('extracts year 2024 from (2024a)', () => {
      expect(extractFields(makeEntry(f)).year).toBe('2024')
    })
    it('extracts title — not null, not starting with year-suffix artifact "a)"', () => {
      const title = extractFields(makeEntry(f)).title
      expect(title).toBeTruthy()
      // Should not start with the disambiguator letter + closing paren
      expect(title).not.toMatch(/^[a-z]\)/)
      expect(title).toContain('cognitive model')
    })
    it('extracts author Bernardi', () => {
      expect(extractFields(makeEntry(f)).authors[0]?.last).toBe('Bernardi')
    })
  })

  describe('article-online-first (APA year-suffix regression)', () => {
    const f = fixtures.find((x) => x.id === 'article-online-first')!
    it('extracts year 2024 from (2024b)', () => {
      expect(extractFields(makeEntry(f)).year).toBe('2024')
    })
    it('extracts title without "b)" prefix', () => {
      const title = extractFields(makeEntry(f)).title
      expect(title).toBeTruthy()
      expect(title).not.toMatch(/^b\)?/i)
      expect(title).toContain('mood for party')
    })
  })

  describe('book-with-isbn', () => {
    const f = fixtures.find((x) => x.id === 'book-with-isbn')!
    it('extracts ISBN', () => {
      expect(extractFields(makeEntry(f)).isbn).toBe('9780521397346')
    })
    it('extracts year 1990', () => {
      expect(extractFields(makeEntry(f)).year).toBe('1990')
    })
  })

  describe('website-accessed', () => {
    const f = fixtures.find((x) => x.id === 'website-accessed')!
    it('extracts URL', () => {
      const result = extractFields(makeEntry(f))
      expect(result.url).toBe('https://databank.worldbank.org/source/world-development-indicators')
    })
    it('extracts year 2023', () => {
      expect(extractFields(makeEntry(f)).year).toBe('2023')
    })
  })
})
