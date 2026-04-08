import { describe, it, expect } from 'vitest'
import { splitIntoEntries, parseReferenceList, classifyType } from '../src/stages/stage1-parse'
import {
  numberedListText,
  blankLineSeparatedText,
  hangingIndentText,
  fixtures,
} from './fixtures/references'

// ── Splitting ─────────────────────────────────────────────────────────────────

describe('splitIntoEntries', () => {
  it('splits numbered list into 3 entries', () => {
    const entries = splitIntoEntries(numberedListText)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toContain('Acemoglu')
    expect(entries[1]).toContain('Pierson')
    expect(entries[2]).toContain('Thelen')
  })

  it('strips the numeric prefix from numbered entries', () => {
    const entries = splitIntoEntries(numberedListText)
    expect(entries[0]).not.toMatch(/^\s*1[\].)]\s/)
  })

  it('splits blank-line separated text into 3 entries', () => {
    const entries = splitIntoEntries(blankLineSeparatedText)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toContain('Acemoglu')
    expect(entries[1]).toContain('Pierson')
    expect(entries[2]).toContain('Thelen')
  })

  it('splits hanging-indent text into 3 entries', () => {
    const entries = splitIntoEntries(hangingIndentText)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toContain('Acemoglu')
    expect(entries[1]).toContain('Pierson')
    expect(entries[2]).toContain('Thelen')
  })

  it('handles single-entry text as one entry', () => {
    const single = 'Pierson, Paul. 2000. "Increasing Returns." American Political Science Review 94 (2): 251–267.'
    expect(splitIntoEntries(single)).toHaveLength(1)
  })

  it('does not treat a 4-digit year at the start of a line as a numbered-list marker', () => {
    const text = [
      'Iyengar, Shanto, et al.',
      '',
      '2019. "The Origins and Consequences of Affective Polarization." Annual Review of Political Science 22: 129–46.',
      '',
      'Mason, Lilliana. 2018. Uncivil Agreement. University of Chicago Press.',
    ].join('\n')
    const entries = splitIntoEntries(text)
    expect(entries).not.toHaveLength(2)
    expect(entries.some((e) => e.includes('2019'))).toBe(true)
  })

  it('ignores a bare "8." on its own line in a single-newline-separated list', () => {
    // "8." appears after a broken URL — should not split a 60-ref list into two entries
    const refs: string[] = []
    for (let i = 0; i < 10; i++) {
      refs.push(`Author${i}, X. 2020. "Title." Journal ${i} (1): 1–10.`)
    }
    // Insert the "8." line after one of them (simulating a broken URL end)
    refs[4] = refs[4] + '\n8.'
    const text = refs.join('\n')
    const entries = splitIntoEntries(text)
    // Should produce 10 entries (one per author), not 2 (split on "8.")
    expect(entries).toHaveLength(10)
  })

  it('ignores spurious numbered markers when blank-line count greatly exceeds marker count', () => {
    // Large blank-line separated list with only one or two lines that happen to
    // start with a small number (e.g. "2. a second point" in a title, or "1." page ref).
    // The numbered splitter should not win over blank-line splitting.
    const refs = [
      'Author A. 2020. "Title one." Journal 1 (1): 1–10.',
      'Author B. 2021. "Title two." Journal 2 (2): 11–20.',
      'Author C. 2022. "Title three." Journal 3 (3): 21–30.',
      'Author D. 2023. "Title four." Journal 4 (4): 31–40.',
      'Author E. 2024. "Title five." Journal 5 (5): 41–50.',
    ]
    // Insert one entry starting with "1." to simulate an accidental marker
    refs[2] = '1. Author C. 2022. "Title three." Journal 3 (3): 21–30.'
    const text = refs.join('\n\n')
    const entries = splitIntoEntries(text)
    // Should produce 5 entries (blank-line split), not 2 (numbered split on "1.")
    expect(entries).toHaveLength(5)
  })
})

// ── Type classification ───────────────────────────────────────────────────────

describe('classifyType', () => {
  const articleFixtures = fixtures.filter((f) => f.type === 'journal-article')
  const bookFixtures = fixtures.filter((f) => f.type === 'book')
  const chapterFixtures = fixtures.filter((f) => f.type === 'book-chapter')
  const websiteFixtures = fixtures.filter((f) => f.type === 'website')

  it.each(articleFixtures)('classifies "$id" as journal-article', ({ raw }) => {
    expect(classifyType(raw).type).toBe('journal-article')
  })

  it.each(bookFixtures)('classifies "$id" as book', ({ raw }) => {
    expect(classifyType(raw).type).toBe('book')
  })

  it.each(chapterFixtures)('classifies "$id" as book-chapter', ({ raw }) => {
    expect(classifyType(raw).type).toBe('book-chapter')
  })

  it.each(websiteFixtures)('classifies "$id" as website', ({ raw }) => {
    expect(classifyType(raw).type).toBe('website')
  })
})

  it('classifies SAGE Vol,Pages format as journal-article', () => {
    const raw =
      'Matthews DR (1959) The Folkways of the United States Senate. American Political Science Review 53, 1064–1089.'
    expect(classifyType(raw).type).toBe('journal-article')
  })

// ── parseReferenceList integration ───────────────────────────────────────────

describe('parseReferenceList', () => {
  it('assigns sequential indexes', () => {
    const results = parseReferenceList(numberedListText)
    expect(results.map((r) => r.index)).toEqual([0, 1, 2])
  })

  it('preserves raw text without numeric prefix', () => {
    const results = parseReferenceList(numberedListText)
    expect(results[0].raw).toContain('Acemoglu')
    expect(results[0].raw).not.toMatch(/^1[.)]\s/)
  })

  it('classifies all 3 numbered entries correctly', () => {
    const results = parseReferenceList(numberedListText)
    expect(results[0].type).toBe('journal-article')
    expect(results[1].type).toBe('journal-article')
    expect(results[2].type).toBe('book')
  })
})
