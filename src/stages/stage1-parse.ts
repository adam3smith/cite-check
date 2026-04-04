import type { RawEntry, ReferenceType, Confidence } from '../types'

// ── Type classification ───────────────────────────────────────────────────────

// No trailing \b — patterns like \d+\s*\(\d+\) end with ')' (non-word char)
// Also catches "Online first" / "Advance online publication" (no volume yet) and
// bare volume-only format like "Journal Name, 87." that has no issue number.
const JOURNAL_SIGNALS =
  /\b(vol\.|volume|no\.|issue|pp?\.\s*\d+|\bDOI\b|doi\.org|online first|advance online|forthcoming|in press)|\d+\s*\(\d+\)/i
// Case-sensitive "In" — require capital I after sentence-ending punctuation to avoid
// matching lowercase preposition "in" (e.g. "in Germany", "in modern Italy").
// Allow an optional closing quote between the period and " In" (common in Chicago style).
const BOOK_CHAPTER_SIGNALS = /[.;]["""\u201d]?\s+In:?\s+[A-Z]|\bed(s?)\.\s*,.*?pp\./
const BOOK_SIGNALS =
  /\b(press|publisher|publishing|edition|2nd ed|3rd ed|\bed\b\.?\s*$|university press)\b/i
const WEBSITE_SIGNALS = /https?:\/\/|www\.|accessed\b|retrieved\b/i

export function classifyType(raw: string): { type: ReferenceType; confidence: Confidence } {
  const text = raw.trim()

  // Website first — URL presence is unambiguous
  if (WEBSITE_SIGNALS.test(text) && !/doi\.org/i.test(text)) {
    // DOI-containing references are articles even if they have a URL
    if (/https?:\/\/|www\./i.test(text) && !/\b(vol\.|volume|\d+\s*\(\d+\))\b/i.test(text)) {
      return { type: 'website', confidence: 'high' }
    }
  }

  // Book chapter — must come before book (chapters can mention press)
  if (BOOK_CHAPTER_SIGNALS.test(text)) {
    return { type: 'book-chapter', confidence: 'high' }
  }

  // Journal article
  if (JOURNAL_SIGNALS.test(text)) {
    return { type: 'journal-article', confidence: 'high' }
  }

  // APA-style article with volume-only citation: ends with ", \d+." (e.g. "Electoral Studies, 87.")
  // Requires APA year pattern (YYYY) or (YYYYa/b) to avoid mis-classifying books
  if (/,\s*\d{1,4}[.,\s]*$/.test(text) && /\(\d{4}[a-z,)]/i.test(text)) {
    return { type: 'journal-article', confidence: 'medium' }
  }

  // URL with journal signals = journal article
  if (WEBSITE_SIGNALS.test(text) && JOURNAL_SIGNALS.test(text)) {
    return { type: 'journal-article', confidence: 'medium' }
  }

  // Book
  if (BOOK_SIGNALS.test(text)) {
    return { type: 'book', confidence: 'medium' }
  }

  // Heuristic: if it has a 4-digit year and ends with a publisher-like word, call it a book
  if (/\b\d{4}\b/.test(text) && /\b(Press|Publishing|Books|Publishers)\b/.test(text)) {
    return { type: 'book', confidence: 'low' }
  }

  return { type: 'other', confidence: 'low' }
}

// ── Splitting strategies ──────────────────────────────────────────────────────

/** Split a numbered list: 1. / 1) / [1] / 1] patterns.
 *  Restricted to 1–3 digit numbers so 4-digit years (e.g. "2019. Title...")
 *  at the start of a continuation line never trigger this strategy.
 *
 *  Sanity check: only use numbered splitting if the marker count is close to
 *  the blank-line entry count. If blank-line splitting yields many more entries
 *  than numbered markers (ratio < 0.6), the numbers are incidental (e.g. a page
 *  number or date fragment) and we fall through to blank-line splitting instead.
 */
function splitNumbered(text: string): string[] | null {
  const marker = /^\s*\[?\d{1,3}[\].)]\s+/m
  if (!marker.test(text)) return null

  const numbered = text
    .split(/(?=^\s*\[?\d{1,3}[\].)]\s+)/m)
    .map((s) => s.replace(/^\s*\[?\d{1,3}[\].)]\s+/, '').trim())
    .filter(Boolean)

  // If blank-line splitting would give substantially more entries, the numbered
  // markers are probably spurious — don't use them.
  const blankLineCandidates = text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean)
  if (blankLineCandidates.length > 1 && numbered.length / blankLineCandidates.length < 0.6) {
    return null
  }

  return numbered
}

/** Split blank-line separated entries */
function splitBlankLine(text: string): string[] | null {
  if (!/\n\s*\n/.test(text)) return null
  return text
    .split(/\n\s*\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * Split hanging-indent format.
 * A new entry starts on a line that is NOT indented (or has less indent than continuation lines)
 * and begins with a capital letter or a year-like pattern.
 */
function splitHangingIndent(text: string): string[] | null {
  const lines = text.split('\n')
  // Detect: most non-empty lines are indented (continuation), some start at column 0 (new entry)
  const indented = lines.filter((l) => /^\s+\S/.test(l))
  const unindented = lines.filter((l) => /^\S/.test(l) && l.trim().length > 0)
  if (indented.length === 0 || unindented.length < 2) return null

  const entries: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (/^\S/.test(line) && line.trim().length > 0) {
      // New entry starts
      if (current.length > 0) entries.push(current.join(' ').replace(/\s+/g, ' ').trim())
      current = [line.trim()]
    } else if (line.trim().length > 0) {
      current.push(line.trim())
    }
  }
  if (current.length > 0) entries.push(current.join(' ').replace(/\s+/g, ' ').trim())
  return entries.length >= 2 ? entries.filter(Boolean) : null
}

/** Fallback: one entry per non-empty line */
function splitByLine(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function splitIntoEntries(rawText: string): string[] {
  const text = rawText.trim()
  return (
    splitNumbered(text) ??
    splitBlankLine(text) ??
    splitHangingIndent(text) ??
    splitByLine(text)
  )
}

export function parseReferenceList(rawText: string): RawEntry[] {
  const entries = splitIntoEntries(rawText)
  return entries.map((raw, i) => {
    const { type, confidence } = classifyType(raw)
    return { index: i, raw, type, parseConfidence: confidence }
  })
}
