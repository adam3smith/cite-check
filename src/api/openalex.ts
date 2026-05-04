import type { AuthorName, LookupResult, NormalizedWork, ParsedReference, ReferenceType } from '../types'
import { scoreReference, weightedTotal } from '../lib/string-distance'
import { CONTACT_EMAIL } from '../config'

const BASE = 'https://api.openalex.org'
const MAILTO = `mailto=${CONTACT_EMAIL}`

// ── Response normalization ────────────────────────────────────────────────────

interface OpenAlexAuthor {
  display_name?: string
  raw_author_name?: string
}

interface OpenAlexAuthorship {
  author?: OpenAlexAuthor
  raw_author_name?: string
}

interface OpenAlexWork {
  id?: string
  doi?: string
  title?: string
  display_name?: string
  publication_year?: number
  type?: string
  authorships?: OpenAlexAuthorship[]
  primary_location?: {
    source?: {
      display_name?: string
    }
  }
  biblio?: {
    volume?: string
    issue?: string
    first_page?: string
    last_page?: string
  }
  open_access?: { oa_url?: string }
}

function openAlexNameToAuthorName(displayName: string): AuthorName {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length === 1) return { last: parts[0], first: null }
  const last = parts[parts.length - 1]
  const first = parts.slice(0, -1).join(' ')
  return { last, first }
}

function normalizeOpenAlexWork(work: OpenAlexWork): NormalizedWork {
  const authors: AuthorName[] = (work.authorships ?? []).map((a) => {
    const name = a.raw_author_name ?? a.author?.display_name ?? ''
    return openAlexNameToAuthorName(name)
  })

  const year = work.publication_year?.toString() ?? null
  const biblio = work.biblio
  const pages =
    biblio?.first_page && biblio?.last_page
      ? `${biblio.first_page}–${biblio.last_page}`
      : biblio?.first_page ?? null

  const doi = work.doi?.replace('https://doi.org/', '') ?? null
  const type = openAlexTypeToLocal(work.type ?? '')

  return {
    title: work.title ?? work.display_name ?? '',
    authors,
    year,
    container: work.primary_location?.source?.display_name ?? null,
    doi,
    isbn: null,
    pages,
    volume: biblio?.volume ?? null,
    issue: biblio?.issue ?? null,
    url: work.open_access?.oa_url ?? null,
    type,
    raw: work as object,
  }
}

function openAlexTypeToLocal(type: string): ReferenceType {
  if (type === 'article') return 'journal-article'
  if (type === 'book') return 'book'
  if (type === 'book-chapter') return 'book-chapter'
  return 'other'
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function lookupByDOI(doi: string, ref: ParsedReference): Promise<LookupResult> {
  const params = new URLSearchParams({
    filter: `doi:${doi}`,
    [MAILTO.split('=')[0]]: MAILTO.split('=')[1],
  })
  const url = `${BASE}/works?${params}`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openalex-doi', apiData: null }
    }
    const json = await res.json()
    const results: OpenAlexWork[] = json.results ?? []
    if (results.length === 0) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openalex-doi', apiData: null }
    }
    return {
      ...ref,
      lookupStatus: 'found',
      lookupSource: 'openalex-doi',
      apiData: normalizeOpenAlexWork(results[0]),
    }
  } catch {
    return { ...ref, lookupStatus: 'error', lookupSource: 'openalex-doi', apiData: null }
  }
}

export async function searchByTitleAuthor(ref: ParsedReference): Promise<LookupResult> {
  const title = ref.title ?? ref.raw
  const authorLast = ref.authors[0]?.last ?? ''

  const params = new URLSearchParams({
    search: title,
    'per-page': '10',
    [MAILTO.split('=')[0]]: MAILTO.split('=')[1],
  })
  if (authorLast) {
    params.set('filter', `raw_author_name.search:${authorLast}`)
  }

  const url = `${BASE}/works?${params}`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openalex', apiData: null }
    }
    const json = await res.json()
    const results: OpenAlexWork[] = json.results ?? []
    if (results.length === 0) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openalex', apiData: null }
    }
    // Score all candidates and return the best match
    const normalized = results.map(normalizeOpenAlexWork)
    const best = normalized.reduce((a, b) =>
      weightedTotal(scoreReference(ref, a)) >= weightedTotal(scoreReference(ref, b)) ? a : b
    )
    return {
      ...ref,
      lookupStatus: 'found',
      lookupSource: 'openalex',
      apiData: best,
    }
  } catch {
    return { ...ref, lookupStatus: 'error', lookupSource: 'openalex', apiData: null }
  }
}
