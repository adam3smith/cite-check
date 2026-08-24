import type { AuthorName, FieldScores, NormalizedWork, ParsedReference, ReferenceType, VerificationStatus } from '../types'

// ── Jaro-Winkler ──────────────────────────────────────────────────────────────

export function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const len1 = s1.length
  const len2 = s2.length
  if (len1 === 0 || len2 === 0) return 0

  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1
  const s1Matches = new Array(len1).fill(false)
  const s2Matches = new Array(len2).fill(false)

  let matches = 0
  let transpositions = 0

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist)
    const end = Math.min(i + matchDist + 1, len2)
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0

  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3
}

export function jaroWinkler(s1: string, s2: string, prefixScale = 0.1): number {
  const jaroScore = jaro(s1, s2)
  // Count common prefix up to 4 chars
  let prefix = 0
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return jaroScore + prefix * prefixScale * (1 - jaroScore)
}

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeForComparison(s: string): string {
  return s
    .toLowerCase()
    .replace(/["""\u201c\u201d\u2018\u2019'']/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Token Jaccard similarity ──────────────────────────────────────────────────

/**
 * Split a normalized string into a set of meaningful word tokens.
 * Skips stop words and very short tokens that don't add discriminative signal.
 */
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'with', 'by'])

function tokenSet(normalized: string): Set<string> {
  return new Set(
    normalized.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )
}

/** Jaccard similarity between two token sets */
export function tokenJaccard(a: string, b: string): number {
  const setA = tokenSet(a)
  const setB = tokenSet(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const tok of setA) {
    if (setB.has(tok)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ── Field-level scoring ───────────────────────────────────────────────────────

/**
 * Expand a Chicago-abbreviated page range to its full form.
 * "529–45" → "529-545",  "849–63" → "849-863",  "1369–401" → "1369-1401"
 * Full ranges and single pages are returned unchanged (dashes normalized).
 */
export function expandPageRange(pages: string): string {
  const s = pages.replace(/[–—]/g, '-').trim()
  const m = s.match(/^(\d+)-(\d+)$/)
  if (!m) return s
  const [, start, end] = m
  if (end.length < start.length) {
    return `${start}-${start.slice(0, start.length - end.length)}${end}`
  }
  return s
}

/** Score two page fields: expands Chicago abbreviated ranges before comparing. */
function pagesScore(input: string | null | undefined, found: string | null | undefined): number {
  if (input == null || found == null) return 0
  const a = expandPageRange(input.trim())
  const b = expandPageRange(found.trim())
  if (a === b) return 1
  return jaroWinkler(normalizeForComparison(a), normalizeForComparison(b))
}

/** Score two string fields using Jaro-Winkler on normalized forms. */
export function fieldScore(input: string | null | undefined, found: string | null | undefined): number {
  if (input == null || found == null) return 0
  const a = normalizeForComparison(input)
  const b = normalizeForComparison(found)
  if (!a || !b) return 0
  return jaroWinkler(a, b)
}

/**
 * Score two title strings using the average of Jaro-Winkler and token Jaccard.
 *
 * JW alone over-rewards long strings that share a common prefix and many characters
 * even when the content is entirely different (e.g. two different journal article titles
 * both starting with "The" and containing common academic words). Jaccard on word tokens
 * correctly distinguishes these because it requires shared meaningful words, not just
 * shared characters.
 *
 * Subtitle truncation bonus: some sources (e.g. OpenLibrary) return only the main title
 * without the subtitle. After normalization the colon is stripped, so "Tyranny of the
 * Minority" becomes a literal prefix of the full normalized title. When one normalized
 * title is a prefix of the other and is at least 25% of its length, we treat that as a
 * near-match (0.92) rather than penalizing the missing subtitle tokens in Jaccard.
 */
export function titleFieldScore(input: string | null | undefined, found: string | null | undefined): number {
  if (input == null || found == null) return 0
  const a = normalizeForComparison(input)
  const b = normalizeForComparison(found)
  if (!a || !b) return 0

  // Subtitle truncation: one title is a strict prefix of the other (different lengths).
  // Some sources (e.g. OpenLibrary) return only the main title; after normalization the
  // colon disappears so the shorter title is a literal prefix of the full normalized form.
  if (a !== b) {
    const shorter = a.length < b.length ? a : b
    const longer  = a.length < b.length ? b : a
    if (shorter.length >= 10 && longer.startsWith(shorter) && shorter.length / longer.length >= 0.25) {
      return 0.92
    }
  }

  const jw = jaroWinkler(a, b)
  const jaccard = tokenJaccard(a, b)
  return (jw + jaccard) / 2
}

/**
 * Strip a leading "City: " or "City, State: " prefix from a publisher string.
 * Chicago-style book references often include the place of publication ("New York: Crown"),
 * but API sources typically return only the publisher name ("Crown").
 */
export function normalizePublisher(s: string | null | undefined): string | null {
  if (!s) return s ?? null
  // Match title-cased words (optionally with comma+state abbreviation) followed by colon
  // e.g. "New York: Crown", "Cambridge, MA: Harvard University Press"
  const m = s.match(/^[A-Z][A-Za-z\s,]+:\s+(.+)/)
  return m ? m[1].trim() : s
}

/** Score year: 1.0 for exact match, 0.7 for ±1 year (online-first / print lag), 0 otherwise */
function yearScore(input: string | null | undefined, found: string | null | undefined): number {
  if (!input || !found) return 0
  if (input.trim() === found.trim()) return 1
  const diff = Math.abs(parseInt(input) - parseInt(found))
  return diff === 1 ? 0.7 : 0
}

/**
 * Score two first-name/initial strings. Deliberately lenient about abbreviation —
 * "J." vs "John" is the same person and must not read as a discrepancy, since citation
 * styles and API sources disagree constantly on whether to spell out a first name. A
 * clearly different *full* first name ("Liyang" vs "Guoer") gets no such pass — that
 * usually means a different person entirely who happens to share a last name.
 */
export function firstNameScore(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 1 // nothing to compare — don't penalize missing data
  const na = a.toLowerCase().replace(/[.\s]/g, '')
  const nb = b.toLowerCase().replace(/[.\s]/g, '')
  if (!na || !nb) return 1
  if (na === nb) return 1
  // Either side reads as initials (a bare letter, or a run like "jm") — only the first
  // letter needs to agree. Middle initials and full-vs-abbreviated mismatches are too
  // inconsistent across sources to penalize.
  if (na.length <= 3 || nb.length <= 3) {
    return na[0] === nb[0] ? 1 : 0.3
  }
  return fieldScore(a, b)
}

/**
 * Score authors: best average match between parsed authors and API authors, weighting
 * last name more heavily than first — see firstNameScore for why first-name mismatches
 * are scored leniently for initials but not for two clearly different full names.
 */
function authorScore(
  parsedAuthors: AuthorName[],
  foundAuthors: AuthorName[],
): number {
  if (!parsedAuthors.length || !foundAuthors.length) return 0

  let total = 0
  for (const pa of parsedAuthors) {
    const best = Math.max(
      ...foundAuthors.map((fa) => fieldScore(pa.last, fa.last) * 0.7 + firstNameScore(pa.first, fa.first) * 0.3),
    )
    total += best
  }
  return total / parsedAuthors.length
}

/** Compute all field scores between a ParsedReference and a NormalizedWork */
export function scoreReference(
  parsed: ParsedReference,
  apiData: NormalizedWork,
): FieldScores {
  return {
    author: authorScore(parsed.authors, apiData.authors),
    title: titleFieldScore(parsed.title, apiData.title),
    year: yearScore(parsed.year, apiData.year),
    container: fieldScore(normalizePublisher(parsed.container), normalizePublisher(apiData.container)),
    pages: pagesScore(parsed.pages, apiData.pages),
  }
}

/** Weighted total score from field scores */
export function weightedTotal(scores: FieldScores): number {
  return (
    scores.author * 0.3 +
    scores.title * 0.4 +
    scores.year * 0.15 +
    scores.container * 0.1 +
    scores.pages * 0.05
  )
}

/**
 * Map a weighted total score to a VerificationStatus.
 *
 * Journal articles get a higher likely-match bar (0.8 vs 0.7): CrossRef/OpenAlex index
 * nearly all published journal articles, so a 70-79% match is more often a real
 * discrepancy worth flagging as "weak" than the online-first/print-date noise that
 * explains most sub-90% scores for other reference types.
 */
export function scoreToStatus(score: number, lookupStatus: string, type?: ReferenceType): VerificationStatus {
  if (lookupStatus === 'not-found') return 'not-found'
  if (lookupStatus === 'unverifiable') return 'unverifiable'
  if (lookupStatus === 'error') return 'not-found'
  const likelyMatchThreshold = type === 'journal-article' ? 0.8 : 0.7
  if (score >= 0.9) return 'verified'
  if (score >= likelyMatchThreshold) return 'likely-match'
  if (score >= 0.5) return 'weak-match'
  return 'not-found'
}
