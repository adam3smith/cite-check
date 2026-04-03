import type { LookupResult, ParsedReference } from '../types'
import { rateLimited } from '../lib/rate-limiter'
import * as crossref from '../api/crossref'
import * as openalex from '../api/openalex'
import * as openlibrary from '../api/openlibrary'
import * as googlebooks from '../api/googlebooks'
import { probeURL } from '../api/url-check'
import { scoreReference, weightedTotal } from '../lib/string-distance'

const CR_DOMAIN = 'api.crossref.org'
const OA_DOMAIN = 'api.openalex.org'
const OL_DOMAIN = 'openlibrary.org'
const GB_DOMAIN = 'googleapis.com'

/** Minimum score to accept a search result as a match (not DOI lookup) */
const MIN_ACCEPT_SCORE = 0.65

// ── Routing ───────────────────────────────────────────────────────────────────

async function lookupJournalArticle(ref: ParsedReference): Promise<LookupResult> {
  // 1. DOI lookup — authoritative
  if (ref.doi) {
    return rateLimited(CR_DOMAIN, () => crossref.lookupByDOI(ref.doi!, ref))
  }

  // 2. CrossRef title+author search
  const crResult = await rateLimited(CR_DOMAIN, () => crossref.searchByTitleAuthor(ref))
  if (crResult.lookupStatus === 'found' && crResult.apiData) {
    const score = weightedTotal(scoreReference(ref, crResult.apiData))
    if (score >= MIN_ACCEPT_SCORE) return crResult
  }

  // 3. OpenAlex fallback
  const oaResult = await rateLimited(OA_DOMAIN, () => openalex.searchByTitleAuthor(ref))
  if (oaResult.lookupStatus === 'found' && oaResult.apiData) {
    const score = weightedTotal(scoreReference(ref, oaResult.apiData))
    if (score >= MIN_ACCEPT_SCORE) return oaResult
  }

  // Nothing found above threshold
  return { ...ref, lookupStatus: 'not-found', lookupSource: null, apiData: null }
}

async function lookupBook(ref: ParsedReference): Promise<LookupResult> {
  // 1. ISBN → OpenLibrary direct lookup
  if (ref.isbn) {
    const olResult = await rateLimited(OL_DOMAIN, () => openlibrary.lookupByISBN(ref.isbn!, ref))
    if (olResult.lookupStatus === 'found') return olResult
  }

  // 2. Google Books title+author search (handles subtitle split better than OpenLibrary)
  const gbResult = await rateLimited(GB_DOMAIN, () => googlebooks.searchByTitleAuthor(ref))
  if (gbResult.lookupStatus === 'found' && gbResult.apiData) {
    const score = weightedTotal(scoreReference(ref, gbResult.apiData))
    console.log('[lookup] googlebooks score:', score.toFixed(3), gbResult.apiData.title)
    if (score >= MIN_ACCEPT_SCORE) return gbResult
  }

  // 3. OpenLibrary fallback
  const olSearchResult = await rateLimited(OL_DOMAIN, () =>
    openlibrary.searchByTitleAuthor(ref),
  )
  if (olSearchResult.lookupStatus === 'found' && olSearchResult.apiData) {
    const score = weightedTotal(scoreReference(ref, olSearchResult.apiData))
    console.log('[lookup] openlibrary score:', score.toFixed(3), olSearchResult.apiData.title)
    if (score >= MIN_ACCEPT_SCORE) return olSearchResult
  }

  return { ...ref, lookupStatus: 'not-found', lookupSource: null, apiData: null }
}

async function lookupBookChapter(ref: ParsedReference): Promise<LookupResult> {
  // Chapters are often indexed in CrossRef
  const crResult = await rateLimited(CR_DOMAIN, () => crossref.searchByTitleAuthor(ref))
  if (crResult.lookupStatus === 'found' && crResult.apiData) {
    const score = weightedTotal(scoreReference(ref, crResult.apiData))
    if (score >= MIN_ACCEPT_SCORE) return crResult
  }

  // OpenAlex fallback
  const oaResult = await rateLimited(OA_DOMAIN, () => openalex.searchByTitleAuthor(ref))
  if (oaResult.lookupStatus === 'found' && oaResult.apiData) {
    const score = weightedTotal(scoreReference(ref, oaResult.apiData))
    if (score >= MIN_ACCEPT_SCORE) return oaResult
  }

  return { ...ref, lookupStatus: 'not-found', lookupSource: null, apiData: null }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function lookupReference(ref: ParsedReference): Promise<LookupResult> {
  switch (ref.type) {
    case 'journal-article':
      return lookupJournalArticle(ref)
    case 'book':
      return lookupBook(ref)
    case 'book-chapter':
      return lookupBookChapter(ref)
    case 'website':
      return probeURL(ref)
    default:
      // 'other' — try CrossRef as best guess
      return rateLimited(CR_DOMAIN, () => crossref.searchByTitleAuthor(ref))
  }
}
