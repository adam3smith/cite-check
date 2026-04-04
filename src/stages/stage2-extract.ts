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
 */
export function extractYear(text: string): string | null {
  // APA: (YYYY) or (YYYYa) / (YYYYb) disambiguators
  // Restrict to plausible year range — prevents matching issue numbers like (6516) or (7945)
  let m = text.match(/\((1[5-9]\d\d|20\d\d)[a-z,)]/)
  if (m) return m[1]
  // Chicago author-date: `. YYYY.` or `. YYYY:`
  m = text.match(/[.;,]\s+(1[5-9]\d\d|20\d\d)[.,:]/)
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

  // Normalize separators: " and " / ";" / " & " → "|"
  let s = segment
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

function parseOneName(s: string): AuthorName | null {
  s = s.trim().replace(/\.$/, '').trim()
  if (!s) return null

  // "Last, First [M.]" format
  const commaMatch = s.match(/^([A-ZÀ-Ÿa-z\-']+(?:\s+[A-ZÀ-Ÿa-z\-']+)*),\s*(.+)/)
  if (commaMatch) {
    return { last: commaMatch[1].trim(), first: commaMatch[2].trim() || null }
  }

  // "First Last" format (less reliable — only use if no comma)
  const words = s.split(/\s+/)
  if (words.length >= 2) {
    return { last: words[words.length - 1], first: words.slice(0, -1).join(' ') }
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

  // Chicago: `. YYYY.` — find the year preceded by period/comma
  const chiIdx = text.search(new RegExp(`[.,]\\s+${yearStr}[.,:]`))
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
    // Volume without issue
    const volOnly = s.match(/\b(\d+)\s*[,:]\s*[\d–]+/)
    if (volOnly && !volume) volume = volOnly[1]
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
  }

  return { title, container, volume, issue, pages }
}

function extractContainerFromRemainder(remainder: string, _type: string): string | null {
  if (!remainder.trim()) return null
  // Strip leading punctuation
  let s = remainder.replace(/^[.,;\s]+/, '').trim()
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
