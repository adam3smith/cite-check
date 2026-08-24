import type { RawEntry, ParsedReference, AuthorName } from '../types'

// ── Normalizers ───────────────────────────────────────────────────────────────

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/["""\u201c\u201d\u2018\u2019'']/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeAuthor(name: AuthorName): string {
  const last = name.last.toLowerCase().trim()
  const first = name.first ? name.first[0].toLowerCase() : ''
  return first ? `${last}, ${first}` : last
}

// ── Field extractors ──────────────────────────────────────────────────────────

export function extractDOI(text: string): string | null {
  // Match doi.org/... or DOI: ... or bare 10.XXXX/... pattern
  const match = text.match(
    /(?:https?:\/\/(?:dx\.)?doi\.org\/|DOI:\s*|doi:\s*)(10\.\d{4,}\/\S+)/i,
  )
  if (match) return match[1].replace(/[.,;)\]>]+$/, '')
  // Bare DOI (starts with 10.)
  const bare = text.match(/\b(10\.\d{4,}\/\S+)/)
  if (bare) return bare[1].replace(/[.,;)\]>]+$/, '')
  return null
}

export function extractISBN(text: string): string | null {
  // ISBN-13 or ISBN-10 with optional hyphens
  const match = text.match(/\bISBN[-:\s]*((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dX])\b/i)
  if (!match) return null
  return match[1].replace(/[-\s]/g, '')
}

export function extractURL(text: string): string | null {
  // Skip DOIs
  const noDoi = text.replace(/https?:\/\/(?:dx\.)?doi\.org\/\S+/gi, '')
  const match = noDoi.match(/https?:\/\/[^\s<>"]+/)
  if (!match) return null
  // Strip trailing punctuation that is likely sentence-ending
  return match[0].replace(/[.,;)\]>]+$/, '')
}

/** Extract 4-digit year from text.
 *  Prefers APA-style (YYYY) or Chicago `. YYYY.` over bare years in titles.
 *  Also handles letter suffixes for multiple works in same year: (2024a), (2024b).
 *  Also handles Vancouver-style `YYYY;` separator.
 */
export function extractYear(text: string): string | null {
  // APA: (YYYY) or (YYYYa) / (YYYYb) disambiguators
  // Restrict to plausible year range — prevents matching issue numbers like (6516) or (7945)
  let m = text.match(/\((1[5-9]\d\d|20\d\d)[a-z,)]/)
  if (m) return m[1]
  // Chicago author-date: `. YYYY.` or `. YYYY:` ; also Vancouver `. YYYY;`
  // Optional letter suffix for multiple works in same year: `. 2004a.`
  m = text.match(/[.;,]\s+(1[5-9]\d\d|20\d\d)[a-z]?[.,;:]/)
  if (m) return m[1]
  // Fall back to any 4-digit year 1500–2099
  m = text.match(/\b(1[5-9]\d\d|20\d\d)\b/)
  if (m) return m[1]
  return null
}

/**
 * Parse an author segment string into AuthorName[].
 * Handles formats:
 *   - Chicago: "Last, First and Last, First"
 *   - APA:     "Last, F. F., & Last, F."
 *   - Simple:  "Last, First"
 *   - Multiple: separated by ", " after first name or " and " or ";"
 */
export function extractAuthors(segment: string): AuthorName[] {
  if (!segment.trim()) return []

  // Strip "et al." / "et al" before parsing
  let s = segment.replace(/[,\s]+et\s+al\.?/gi, '').trim()

  // Normalize separators: " and " / ";" / " & " → "|"
  s = s
    .replace(/\s+and\s+/gi, '|')
    .replace(/\s*[;&]\s*/g, '|')
    .trim()

  const parts = s.split('|').map((p) => p.trim()).filter(Boolean)
  const authors: AuthorName[] = []

  for (const part of parts) {
    const author = parseOneName(part)
    if (author) authors.push(author)
  }
  return authors
}

// Lowercase surname particles ("Jeroen van den Bergh", "Ludwig von Mises") that belong
// to the last name, not the first — only checked when the word is actually lowercase in
// the source text, so a genuine capitalized name is never mistaken for one.
const NAME_PARTICLES = new Set([
  'van', 'von', 'der', 'den', 'ten', 'ter', 'te', 'zu', 'zur', 'af', 'av',
  'de', 'du', 'des', 'la', 'le',
  'di', 'da', 'del', 'della', 'dello', 'degli', 'dei', 'dos', 'das', 'do',
  'al', 'el', 'bin', 'ibn',
])

/**
 * Split "First [Middle] [particles] Last" into { first, last }, walking backward from
 * the final word and absorbing any lowercase particles immediately preceding it into
 * the surname (e.g. "Jeroen van den Bergh" → last "van den Bergh", not just "Bergh").
 */
function splitFirstLastWithParticles(words: string[]): { first: string; last: string } {
  let start = words.length - 1
  while (start > 0 && words[start - 1] === words[start - 1].toLowerCase() && NAME_PARTICLES.has(words[start - 1])) {
    start--
  }
  return { first: words.slice(0, start).join(' '), last: words.slice(start).join(' ') }
}

function parseOneName(s: string): AuthorName | null {
  s = s.trim().replace(/\.$/, '').trim()
  if (!s) return null

  // Chicago-style "same author as previous entry" placeholder (———, ----, etc.) —
  // never a real name. Filling it in from the previous entry is handled separately
  // by fillRepeatedAuthors(); here we just make sure it isn't parsed as a literal name.
  if (/^[-–—]{2,}$/.test(s)) return null

  // "Last, First [M.]" format
  const commaMatch = s.match(/^([A-ZÀ-Ÿa-z\-']+(?:\s+[A-ZÀ-Ÿa-z\-']+)*),\s*(.+)/)
  if (commaMatch) {
    return { last: commaMatch[1].trim(), first: commaMatch[2].trim() || null }
  }

  // Vancouver all-caps format: "LASTNAME GM" — last token is short initials (≤3 caps)
  // Distinguish from "First Last" by detecting that the final token is initials-like
  const words = s.split(/\s+/)
  if (words.length >= 2) {
    const lastToken = words[words.length - 1]
    // "LastName AB" / "LastName A-S" format (Vancouver, SAGE, etc.):
    // last token is 1–5 chars of uppercase letters and hyphens, starting with a letter
    if (lastToken.length <= 5 && /^[A-Z][A-Z\-]*$/.test(lastToken)) {
      return { last: words.slice(0, -1).join(' '), first: lastToken }
    }
    // "First Last" format (less reliable)
    return splitFirstLastWithParticles(words)
  }

  // Single word — treat as last name
  return { last: s, first: null }
}

// ── Author segment detection ──────────────────────────────────────────────────

/**
 * Find the end of the author segment. Authors come before the year.
 * Returns the index in `text` where the author segment ends.
 */
function findAuthorSegmentEnd(text: string, yearStr: string | null): number {
  if (!yearStr) return 0

  // Find the year in context (APA in parens, Chicago after punctuation)
  const apaIdx = text.indexOf(`(${yearStr}`)
  if (apaIdx !== -1) return apaIdx

  // Chicago: `. YYYY.` or `. 2004a.` — find the year preceded by period/comma
  const chiIdx = text.search(new RegExp(`[.,]\\s+${yearStr}[a-z]?[.,;:]`))
  if (chiIdx !== -1) return chiIdx + 1 // include the period before year

  return 0
}

// ── Title / container extraction ──────────────────────────────────────────────

/** Remove curly/straight quotes from the start and end of a string */
function stripQuotes(s: string): string {
  return s.replace(/^["""\u201c\u201d\u2018\u2019'']+/, '').replace(/["""\u201c\u201d\u2018\u2019'']+$/, '').trim()
}

/**
 * Extract title and container from the portion after the year.
 * afterYear looks like:
 *   Chicago article: `"Title." Container Vol (Issue): Pages.`
 *   Chicago book:    `Title: Subtitle. Publisher.`
 *   APA article:     `Title of article. Journal Name, Vol(Issue), Pages.`
 */
function extractTitleAndContainer(
  afterYear: string,
  type: string,
): { title: string | null; container: string | null; volume: string | null; issue: string | null; pages: string | null } {
  let title: string | null = null
  let container: string | null = null
  let volume: string | null = null
  let issue: string | null = null
  let pages: string | null = null

  const s = afterYear.trim()

  // ── Volume / issue / pages (for articles) ──
  const volIssuePages = s.match(/(\d+)\s*\((\d+)\)\s*[,:]\s*([\d–\-]+)/)
  if (volIssuePages) {
    volume = volIssuePages[1]
    issue = volIssuePages[2]
    pages = volIssuePages[3]
  } else {
    // Pages without volume/issue: pp. 1–37 or : 251–267
    const pagesOnly = s.match(/(?:pp?\.\s*|:\s*)([\d–\-]+(?:–[\d]+)?)/)
    if (pagesOnly) pages = pagesOnly[1]
    // Vol, StartPage–EndPage (SAGE style: no issue, comma separator)
    const volCommaPages = s.match(/\b(\d+),\s*([\d]+[–\-][\d]+)/)
    if (volCommaPages) {
      if (!volume) volume = volCommaPages[1]
      if (!pages) pages = volCommaPages[2]
    } else {
      // Volume without issue
      const volOnly = s.match(/\b(\d+)\s*[,:]\s*[\d–]+/)
      if (volOnly && !volume) volume = volOnly[1]
    }
  }

  // ── Title extraction ──
  // Chicago: title is in curly/straight quotes
  const quotedTitle = s.match(/["""\u201c](.+?)["""\u201d]/)
  if (quotedTitle) {
    title = quotedTitle[1].trim()
    // Container is what comes after the closing quote + period
    const afterTitle = s.slice(s.indexOf(quotedTitle[0]) + quotedTitle[0].length)
    container = extractContainerFromRemainder(afterTitle, type)
  } else {
    // No quotes — title ends at first period not followed by a single uppercase+period (abbreviation)
    // or at the container signal
    const segments = s.split(/\.\s+/)
    if (segments.length >= 1) {
      title = stripQuotes(segments[0].replace(/[.,:;]+$/, '').trim())
    }
    if (segments.length >= 2) {
      container = extractContainerFromRemainder(segments.slice(1).join('. '), type)
    }

    // Title ends with "?" and journal follows directly with no intervening period
    // e.g. "...Parliament? Politics & Gender 16, 388–408"
    // Guard: only when container not already found, and vol/pages pattern appears after the ?
    if (!container && title) {
      const qMatch = title.match(/\?\s+([A-Z].+?(?:\d+\s*\(\d+\)|\d+,\s*\d+[–\-]\d+))/)
      if (qMatch) {
        title = title.slice(0, title.indexOf(qMatch[0]) + 1).trim()
        container = extractContainerFromRemainder(qMatch[1], type)
      }
    }
  }

  return { title, container, volume, issue, pages }
}

function extractContainerFromRemainder(remainder: string, _type: string): string | null {
  if (!remainder.trim()) return null
  // Strip leading punctuation
  let s = remainder.replace(/^[.,;\s]+/, '').trim()
  // Strip "Vol. N." or "Vol. N," prefix (Chicago bib edition notation before publisher)
  s = s.replace(/^vol\.\s*\d+[.,]?\s*/i, '')
  // For book chapters: container is after "In " — ignore it, return publisher
  if (/^In:?\s+/i.test(s)) {
    // publisher is near the end
    const parts = s.split(/[.,]\s+/)
    return parts[parts.length - 1]?.replace(/\.$/, '').trim() ?? null
  }
  // Strip volume/issue/pages suffix
  s = s.replace(/\s*\d+\s*\(\d+\)\s*[,:]\s*[\d–\-]+.*$/, '')
  s = s.replace(/,\s*\d+\s*\(\d+\).*$/, '')
  s = s.replace(/\s+\d+\s*[,:]\s*[\d–\-]+.*$/, '')
  // MLA-style: " 110, no. 2" trailing volume/issue notation
  s = s.replace(/,?\s+\d+,\s+no\.\s+\d+.*$/, '')
  s = s.replace(/[.,\s]+$/, '').trim()
  return s || null
}

// ── Main export ───────────────────────────────────────────────────────────────

export function extractFields(entry: RawEntry): ParsedReference {
  const raw = entry.raw

  const doi = extractDOI(raw)
  const isbn = extractISBN(raw)
  const url = extractURL(raw)
  const year = extractYear(raw)

  // Strip DOI URL from text before author/title extraction
  const cleaned = raw
    .replace(/https?:\/\/(?:dx\.)?doi\.org\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  // ── Book-chapter with quoted chapter title ───────────────────────────────
  // Chicago bibliography / endnote style:
  //   Author. "Chapter Title." In Editor(s) eds. Book Title. Publisher[, YEAR[, pp. N–M]].
  // Guard: if the pre-quote segment contains a year, this is author-date style → fall through.
  if (entry.type === 'book-chapter') {
    const chapterMatch = cleaned.match(/^(.+?)\.\s*["""\u201c](.*?)["""\u201d]/)
    if (chapterMatch && !/\b(1[5-9]\d\d|20\d\d)\b/.test(chapterMatch[1])) {
      const authors = extractAuthors(chapterMatch[1])
      const chapterTitle = chapterMatch[2].replace(/\.$/, '').trim()

      // Find closing-quote followed by " In" to locate the editor/book portion
      const inIdx = cleaned.search(/["""\u201d]\s+In\b/i)
      const afterIn = inIdx >= 0
        ? cleaned.slice(inIdx + 1).replace(/^\s*In:?\s*/i, '').trim()
        : ''

      // Skip editor names: take everything after "eds?." or "ed."
      const edMatch = afterIn.match(/^(.*?)\beds?\.\s+(.+)$/i)
      const afterEds = edMatch ? edMatch[2].trim() : afterIn

      // Book title = first sentence segment of afterEds (title may end with . ? or !)
      const firstSentEnd = afterEds.search(/[.?!]\s+/)
      const container = firstSentEnd > 0
        ? afterEds.slice(0, firstSentEnd + 1).trim() || null
        : afterEds.replace(/[.,\s]+$/, '').trim() || null

      // Pages from "pp. N–M" anywhere in afterEds
      const pagesM = afterEds.match(/\bpp?\.\s*([\d–\-]+(?:[–\-][\d]+)?)/)
      const pages = pagesM ? pagesM[1] : null

      return {
        ...entry,
        authors,
        year,
        title: chapterTitle,
        container,
        doi,
        url,
        isbn,
        pages,
        volume: null,
        issue: null,
      }
    }
  }

  // ── Back-date format detection ────────────────────────────────────────────
  // MLA:       AUTHOR. "Title." Journal Vol, no. Issue (YEAR): Pages.
  // Vancouver: AUTHOR. Title. Journal. YEAR;Vol(Issue):Pages.
  // Both have unambiguous year markers never seen in author-date format.
  const isBackDate =
    /\((1[5-9]\d\d|20\d\d)\)\s*:/.test(cleaned) ||   // MLA: (YEAR):
    /\b(1[5-9]\d\d|20\d\d);/.test(cleaned) ||         // Vancouver: YEAR;
    /,\s*(1[5-9]\d\d|20\d\d)\.?\s*$/.test(cleaned)   // Chicago bib: ends with ", YYYY."

  if (isBackDate && year) {
    // Author block ends at the first period before a quoted title or a title-case word
    const bdAuthorEnd = cleaned.search(/\.\s+(?=["""\u201c\u2018']|[A-Z][a-z])/)
    const authorSegment = bdAuthorEnd > 0 ? cleaned.slice(0, bdAuthorEnd) : ''
    const authors = extractAuthors(authorSegment)

    // Middle portion (between author end and year start) contains title + container
    const yearIdx = cleaned.search(new RegExp(`\\b${year}`))
    const middle =
      bdAuthorEnd >= 0 && yearIdx > bdAuthorEnd
        ? cleaned.slice(bdAuthorEnd + 1, yearIdx).trim()
        : ''
    const mid = extractTitleAndContainer(middle, entry.type)

    // After-year contains vol/issue/pages (Vancouver: ;Vol(Issue):Pages  MLA: ): Pages)
    const afterYearRaw = yearIdx >= 0 ? cleaned.slice(yearIdx + year.length) : ''
    const afterYear = afterYearRaw.replace(/^[a-z]?[),;.\s]+/, '').trim()
    const aft = extractTitleAndContainer(afterYear, entry.type)

    return {
      ...entry,
      authors,
      year,
      title: mid.title,
      container: mid.container,
      doi,
      url,
      isbn,
      pages: aft.pages ?? mid.pages,
      volume: aft.volume ?? mid.volume,
      issue: aft.issue ?? mid.issue,
    }
  }

  // ── Standard author-date extraction ──────────────────────────────────────

  // Find where authors end
  const authorEnd = findAuthorSegmentEnd(cleaned, year)
  const authorSegment = authorEnd > 0 ? cleaned.slice(0, authorEnd) : ''

  const authors = extractAuthors(authorSegment)

  // Find where year ends to get "after year" portion.
  // No trailing \b — years can be immediately followed by a letter disambiguator
  // (e.g. "2024a", "2024b") which is a word character that breaks \b.
  let afterYear = ''
  if (year) {
    const yearIdx = cleaned.search(new RegExp(`\\b${year}`))
    if (yearIdx !== -1) {
      // Strip the letter suffix (a/b/c), closing paren, and sentence punctuation/spaces
      afterYear = cleaned.slice(yearIdx + year.length).replace(/^[a-z]?[),.\s]+/, '').trim()
    }
  }

  const { title, container, volume, issue, pages } = extractTitleAndContainer(
    afterYear,
    entry.type,
  )

  return {
    ...entry,
    authors,
    year,
    title,
    container,
    doi,
    url,
    isbn,
    pages,
    volume,
    issue,
  }
}

// ── Repeated-author placeholder fill-in ────────────────────────────────────────

// Chicago-style bibliographies replace a repeated author with a run of dashes
// (———, ----, --, etc.) instead of repeating the name. Matches only when the dash
// run is the entry's author position (start of the line, followed by the usual
// author-ending punctuation).
const REPEATED_AUTHOR_PLACEHOLDER = /^[-–—]{2,}\s*[.,;:]/

export function isRepeatedAuthorPlaceholder(raw: string): boolean {
  return REPEATED_AUTHOR_PLACEHOLDER.test(raw.trim())
}

/**
 * Fill in dash-placeholder authors from the nearest preceding entry that has real
 * authors. Must run after extractFields, over entries in their original order —
 * a single entry's fields carry no information about neighboring entries.
 */
export function fillRepeatedAuthors(entries: ParsedReference[]): ParsedReference[] {
  let previousAuthors: AuthorName[] = []
  const result: ParsedReference[] = []

  for (const entry of entries) {
    if (isRepeatedAuthorPlaceholder(entry.raw) && previousAuthors.length > 0) {
      result.push({ ...entry, authors: previousAuthors })
      continue
    }
    result.push(entry)
    if (entry.authors.length > 0) previousAuthors = entry.authors
  }

  return result
}
