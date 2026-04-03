import type { AuthorName, LookupResult, NormalizedWork, ParsedReference } from '../types'
import { scoreReference, weightedTotal } from '../lib/string-distance'

const BASE = 'https://openlibrary.org'

// ── Response normalization ────────────────────────────────────────────────────

interface OpenLibraryDoc {
  title?: string
  author_name?: string[]
  first_publish_year?: number
  publisher?: string[]
  isbn?: string[]
}

// Name particles that prefix compound last names (de, van, von, etc.)
const PARTICLES = new Set(['de', 'van', 'von', 'le', 'la', 'di', 'du', 'der', 'den', 'ten', 'ter', 'del', 'della', 'dos', 'das', 'do'])

/** Parse a "First [Particle] Last" string into AuthorName, handling compound last names. */
function parseFirstLast(name: string): AuthorName {
  const parts = name.trim().replace(/\.$/, '').split(/\s+/)
  if (parts.length === 1) return { last: parts[0], first: null }
  // Walk back from end: include any particle words as part of the last name
  let lastStart = parts.length - 1
  while (lastStart > 1 && PARTICLES.has(parts[lastStart - 1].toLowerCase())) {
    lastStart--
  }
  return {
    last: parts.slice(lastStart).join(' '),
    first: parts.slice(0, lastStart).join(' ') || null,
  }
}

function normalizeOpenLibraryWork(doc: OpenLibraryDoc): NormalizedWork {
  const authors: AuthorName[] = (doc.author_name ?? []).map(parseFirstLast)

  const isbn = doc.isbn?.[0]?.replace(/[-\s]/g, '') ?? null

  return {
    title: doc.title ?? '',
    authors,
    year: doc.first_publish_year?.toString() ?? null,
    container: doc.publisher?.[0] ?? null,
    doi: null,
    isbn,
    pages: null,
    volume: null,
    issue: null,
    url: null,
    type: 'book',
    raw: doc as object,
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function searchByTitleAuthor(ref: ParsedReference): Promise<LookupResult> {
  // Strip subtitle — OpenLibrary metadata often lacks subtitles and the mismatch hurts search
  const fullTitle = ref.title ?? ref.raw
  const title = fullTitle.split(':')[0].trim()
  const authorLast = ref.authors[0]?.last ?? ''

  const params = new URLSearchParams({
    title,
    ...(authorLast ? { author: authorLast } : {}),
    limit: '3',
    fields: 'title,author_name,first_publish_year,publisher,isbn',
  })

  const url = `${BASE}/search.json?${params}`
  console.log('[openlibrary] search:', url)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openlibrary', apiData: null }
    }
    const json = await res.json()
    const docs: OpenLibraryDoc[] = json.docs ?? []
    if (docs.length === 0) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openlibrary', apiData: null }
    }
    const candidates = docs.map(normalizeOpenLibraryWork)
    const best = candidates.reduce((a, b) =>
      weightedTotal(scoreReference(ref, b)) > weightedTotal(scoreReference(ref, a)) ? b : a,
    )
    return {
      ...ref,
      lookupStatus: 'found',
      lookupSource: 'openlibrary',
      apiData: best,
    }
  } catch {
    return { ...ref, lookupStatus: 'error', lookupSource: 'openlibrary', apiData: null }
  }
}

export async function lookupByISBN(isbn: string, ref: ParsedReference): Promise<LookupResult> {
  const url = `${BASE}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openlibrary', apiData: null }
    }
    const json = await res.json()
    const key = `ISBN:${isbn}`
    const book = json[key]
    if (!book) {
      return { ...ref, lookupStatus: 'not-found', lookupSource: 'openlibrary', apiData: null }
    }

    const authors: AuthorName[] = (book.authors ?? []).map((a: { name?: string }) => {
      const name = a.name ?? ''
      const parts = name.split(/\s+/)
      return { last: parts[parts.length - 1] ?? name, first: parts.slice(0, -1).join(' ') || null }
    })

    const normalizedWork: NormalizedWork = {
      title: book.title ?? '',
      authors,
      year: book.publish_date?.match(/\d{4}/)?.[0] ?? null,
      container: book.publishers?.[0]?.name ?? null,
      doi: null,
      isbn,
      pages: null,
      volume: null,
      issue: null,
      url: book.url ?? null,
      type: 'book',
      raw: book as object,
    }

    return { ...ref, lookupStatus: 'found', lookupSource: 'openlibrary', apiData: normalizedWork }
  } catch {
    return { ...ref, lookupStatus: 'error', lookupSource: 'openlibrary', apiData: null }
  }
}
