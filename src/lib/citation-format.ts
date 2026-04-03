import { plugins } from '@citation-js/core'
import { Cite } from '@citation-js/core'
import '@citation-js/plugin-csl'
import '@citation-js/plugin-doi'
import '@citation-js/plugin-isbn'
import type { NormalizedWork } from '../types'

const TEMPLATE_NAME = 'chicago-author-date'
const CSL_CACHE_KEY = 'cite-check-chicago-csl'
let cslRegistered = false

/**
 * Fetch and register the Chicago Author-Date CSL template.
 * Must be called once before formatChicago() is used.
 * Caches the CSL XML in sessionStorage to avoid re-fetching.
 */
export async function initCitationFormat(cslPath = '/cite-check/csl/chicago-author-date.csl'): Promise<void> {
  if (cslRegistered) return

  let cslXml = sessionStorage.getItem(CSL_CACHE_KEY)
  if (!cslXml) {
    const res = await fetch(cslPath)
    if (!res.ok) throw new Error(`Failed to fetch CSL file: ${res.status}`)
    cslXml = await res.text()
    sessionStorage.setItem(CSL_CACHE_KEY, cslXml)
  }

  // Register with citation.js CSL plugin
  // plugins.config.get() returns undefined when the plugin hasn't registered its
  // config key yet (race condition on first load). Retry once after a short delay.
  let config = plugins.config.get('@csl')
  if (!config) {
    await new Promise((r) => setTimeout(r, 200))
    config = plugins.config.get('@csl')
  }
  if (!config) throw new Error('citation.js CSL plugin config not available')
  config.templates.add(TEMPLATE_NAME, cslXml)
  cslRegistered = true
}

/**
 * Convert a NormalizedWork to CSL-JSON format understood by citation.js.
 * CrossRef data is already close to CSL-JSON; other sources need mapping.
 */
function toCslJson(work: NormalizedWork): object {
  const type = work.type === 'journal-article' ? 'article-journal'
    : work.type === 'book-chapter' ? 'chapter'
    : work.type === 'book' ? 'book'
    : work.type === 'website' ? 'webpage'
    : 'article'

  return {
    type,
    title: work.title,
    author: work.authors.map((a) => ({ family: a.last, given: a.first ?? '' })),
    issued: work.year ? { 'date-parts': [[parseInt(work.year)]] } : undefined,
    'container-title': work.container ?? undefined,
    DOI: work.doi ?? undefined,
    ISBN: work.isbn ?? undefined,
    page: work.pages ?? undefined,
    volume: work.volume ?? undefined,
    issue: work.issue ?? undefined,
    URL: work.url ?? undefined,
  }
}

/**
 * Format a NormalizedWork as a Chicago Author-Date bibliography entry.
 * Returns null if citation.js fails (e.g. missing required fields).
 */
export async function formatChicago(work: NormalizedWork): Promise<string | null> {
  try {
    const cslData = toCslJson(work)
    const cite = await Cite.async(cslData)
    const output = cite.format('bibliography', {
      format: 'text',
      template: TEMPLATE_NAME,
      lang: 'en-US',
    }) as string
    return output.trim() || null
  } catch {
    return null
  }
}
