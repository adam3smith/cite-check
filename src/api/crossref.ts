import type { AuthorName, LookupResult, NormalizedWork, ParsedReference, ReferenceType } from '../types'
import { scoreReference, weightedTotal } from '../lib/string-distance'
import { CONTACT_EMAIL } from '../config'

const BASE = 'https://api.crossref.org'
const MAILTO = `mailto=${CONTACT_EMAIL}`

// ── Response normalization ────────────────────────────────────────────────────

interface CrossRefAuthor {
  family?: string
  given?: string
  name?: string
}

interface CrossRefWork {
  title?: string[]
  'short-title'?: string[]
  author?: CrossRefAuthor[]
  'container-title'?: string[]
  DOI?: string
  issued?: { 'date-parts'?: [[number, ...number[]]] }
  page?: string
  volume?: string
  issue?: string
  type?: string
  ISBN?: string[]
  URL?: string
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function normalizeCrossRefWork(work: CrossRefWork): NormalizedWork {
  const authors: AuthorName[] = (work.author ?? []).map((a) => ({
    last: a.family ?? a.name ?? '',
    first: a.given ?? null,
  }))

  const yearParts = work.issued?.['date-parts']?.[0]
  const year = yearParts?.[0]?.toString() ?? null

  const type = crossRefTypeToLocal(work.type ?? '')

  return {
    title: decodeHtmlEntities(work.title?.[0] ?? ''),
    authors,
    year,
    container: decodeHtmlEntities(work['container-title']?.[0] ?? '') || null,
    doi: work.DOI ?? null,
    isbn: work.ISBN?.[0]?.replace(/[-\s]/g, '') ?? null,
    pages: work.page ?? null,
    volume: work.volume ?? null,
    issue: work.issue ?? null,
    url: work.URL ?? null,
    type,
    raw: work as object,
  }
}

function crossRefTypeToLocal(type: string): ReferenceType {
  if (type === 'journal-article') return 'journal-article'
  if (type === 'book') return 'book'
  if (type.includes('chapter') || type === 'book-part') return 'book-chapter'
  return 'other'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Given multiple candidate NormalizedWorks, return the one with the highest field score. */
function pickBestMatch(ref: ParsedReference, candidates: NormalizedWork[]): NormalizedWork {
  let best = candidates[0]
  let bestScore = weightedTotal(scoreReference(ref, candidates[0]))
  for (let i = 1; i < candidates.length; i++) {
    const score = weightedTotal(scoreReference(ref, candidates[i]))
    if (score > bestScore) {
      bestScore = score
      best = candidates[i]
    }
  }
  return best
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function lookupByDOI(doi: string, ref: ParsedReference): Promise<LookupResult> {
  const url = `${BASE}/works/${encodeURIComponent(doi)}?${MAILTO}`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'crossref-doi', apiData: null }
    }
    const json = await res.json()
    const work = json.message as CrossRefWork
    return {
      ...ref,
      lookupStatus: 'found',
      lookupSource: 'crossref-doi',
      apiData: normalizeCrossRefWork(work),
    }
  } catch {
    return { ...ref, lookupStatus: 'error', lookupSource: 'crossref-doi', apiData: null }
  }
}

export async function searchByTitleAuthor(
  ref: ParsedReference,
  rows = 10,
): Promise<LookupResult> {
  const title = ref.title ?? ref.raw
  const authorParam = ref.authors[0]?.last ?? ''

  // No year filter: many papers have an online-first date one year before the
  // print/reference date (the Chung 2012 paper has "2011" in its DOI, for example).
  // Year is used in scoring instead, which tolerates a one-year discrepancy.
  const params = new URLSearchParams({
    'query.title': title,
    ...(authorParam ? { 'query.author': authorParam } : {}),
    rows: String(rows),
    mailto: CONTACT_EMAIL,
  })

  const url = `${BASE}/works?${params}`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'crossref-search', apiData: null }
    }
    const json = await res.json()
    const items: CrossRefWork[] = json.message?.items ?? []
    if (items.length === 0) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'crossref-search', apiData: null }
    }
    // Score all returned items and return the best match, not just the top-ranked one.
    // CrossRef's relevance ranking is good but not perfect — the right paper sometimes
    // ranks 2nd or 3rd when the title has common words.
    const normalized = items.map(normalizeCrossRefWork)
    const bestWork = pickBestMatch(ref, normalized)
    return {
      ...ref,
      lookupStatus: 'found',
      lookupSource: 'crossref-search',
      apiData: bestWork,
    }
  } catch {
    return { ...ref, lookupStatus: 'error', lookupSource: 'crossref-search', apiData: null }
  }
}
