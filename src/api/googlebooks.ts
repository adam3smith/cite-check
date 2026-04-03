import type { AuthorName, LookupResult, NormalizedWork, ParsedReference } from '../types'
import { scoreReference, weightedTotal } from '../lib/string-distance'

const BASE = 'https://www.googleapis.com/books/v1'

// ── Author name parsing ───────────────────────────────────────────────────────

const PARTICLES = new Set(['de', 'van', 'von', 'le', 'la', 'di', 'du', 'der', 'den', 'ten', 'ter', 'del', 'della', 'dos', 'das', 'do'])

function parseFirstLast(name: string): AuthorName {
  const parts = name.trim().replace(/\.$/, '').split(/\s+/)
  if (parts.length === 1) return { last: parts[0], first: null }
  let lastStart = parts.length - 1
  while (lastStart > 1 && PARTICLES.has(parts[lastStart - 1].toLowerCase())) {
    lastStart--
  }
  return {
    last: parts.slice(lastStart).join(' '),
    first: parts.slice(0, lastStart).join(' ') || null,
  }
}

// ── Response normalization ────────────────────────────────────────────────────

interface GoogleBooksVolumeInfo {
  title?: string
  subtitle?: string
  authors?: string[]
  publishedDate?: string
  publisher?: string
  industryIdentifiers?: { type: string; identifier: string }[]
  pageCount?: number
}

interface GoogleBooksVolume {
  volumeInfo?: GoogleBooksVolumeInfo
}

function normalizeGoogleBooksWork(vol: GoogleBooksVolume): NormalizedWork {
  const info = vol.volumeInfo ?? {}

  const authors: AuthorName[] = (info.authors ?? []).map(parseFirstLast)

  const isbn =
    info.industryIdentifiers?.find((id) => id.type === 'ISBN_13')?.identifier ??
    info.industryIdentifiers?.find((id) => id.type === 'ISBN_10')?.identifier ??
    null

  const year = info.publishedDate?.match(/\d{4}/)?.[0] ?? null

  // Combine title + subtitle so scoring sees the full title
  const fullTitle = info.subtitle
    ? `${info.title ?? ''}: ${info.subtitle}`
    : (info.title ?? '')

  return {
    title: fullTitle,
    authors,
    year,
    container: info.publisher ?? null,
    doi: null,
    isbn: isbn?.replace(/[-\s]/g, '') ?? null,
    pages: null,
    volume: null,
    issue: null,
    url: null,
    type: 'book',
    raw: vol as object,
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function searchByTitleAuthor(ref: ParsedReference): Promise<LookupResult> {
  const fullTitle = ref.title ?? ref.raw
  // Use only the main title (before colon/subtitle) for intitle: — colons confuse the filter
  const mainTitle = fullTitle.split(':')[0].trim()
  const authorLast = ref.authors[0]?.last ?? ''

  const q = [
    `intitle:${encodeURIComponent(mainTitle)}`,
    authorLast ? `inauthor:${encodeURIComponent(authorLast)}` : '',
  ]
    .filter(Boolean)
    .join('+')

  const url = `${BASE}/volumes?q=${q}&maxResults=5&printType=books`
  console.log('[googlebooks] search:', url)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'google-books', apiData: null }
    }
    const json = await res.json()
    const items: GoogleBooksVolume[] = json.items ?? []
    if (items.length === 0) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'google-books', apiData: null }
    }
    const candidates = items.map(normalizeGoogleBooksWork)
    const best = candidates.reduce((a, b) =>
      weightedTotal(scoreReference(ref, b)) > weightedTotal(scoreReference(ref, a)) ? b : a,
    )
    return {
      ...ref,
      lookupStatus: 'found',
      lookupSource: 'google-books',
      apiData: best,
    }
  } catch {
    return { ...ref, lookupStatus: 'error', lookupSource: 'google-books', apiData: null }
  }
}
