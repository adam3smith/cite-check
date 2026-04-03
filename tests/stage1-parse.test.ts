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
