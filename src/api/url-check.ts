import type { LookupResult, ParsedReference } from '../types'

/**
 * Probe a URL to check reachability.
 *
 * Limitations (client-side):
 * - Most external URLs will return an opaque response in no-cors mode,
 *   meaning we can confirm the server is reachable but not the status code.
 * - A network/DNS error (TypeError) indicates the URL is likely unreachable.
 * - CORS-enabled URLs (rare for arbitrary web pages) will return actual status.
 */
export async function probeURL(ref: ParsedReference): Promise<LookupResult> {
  const url = ref.url
  if (!url) {
    return { ...ref, lookupStatus: 'unverifiable', lookupSource: 'url-check', apiData: null }
  }

  try {
    // Try with no-cors first — works for all URLs, gives opaque response
    const res = await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
    // If we reach here without throwing, server responded (opaque = CORS-blocked but reachable)
    // res.type === 'opaque' means CORS-blocked, status = 0 (unknown)
    // res.ok would only be true for same-origin or CORS-enabled URLs
    if (res.type === 'opaque') {
      return {
        ...ref,
        lookupStatus: 'unverifiable',
        lookupSource: 'url-check',
        apiData: null,
      }
    }
    // CORS-enabled response — we can check status
    if (res.ok) {
      return { ...ref, lookupStatus: 'found', lookupSource: 'url-check', apiData: null }
    }
    return { ...ref, lookupStatus: 'not-found', lookupSource: 'url-check', apiData: null }
  } catch {
    // Network error, DNS failure, or connection refused → treat as not-found
    return { ...ref, lookupStatus: 'not-found', lookupSource: 'url-check', apiData: null }
  }
}
