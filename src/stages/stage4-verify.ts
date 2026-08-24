import type { Discrepancy, FieldScores, LookupResult, VerifiedReference } from '../types'
import { scoreReference, weightedTotal, scoreToStatus } from '../lib/string-distance'
import { formatChicago } from '../lib/citation-format'

// ── Discrepancy detection ─────────────────────────────────────────────────────

function makeDiscrepancy(
  field: string,
  input: string | null | undefined,
  found: string | null | undefined,
  score: number,
): Discrepancy | null {
  if (!input && !found) return null
  if (score >= 0.95) return null // near-perfect match, no discrepancy

  const inputStr = input ?? '(not found in input)'
  const foundStr = found ?? '(not found in source)'
  const severity = score >= 0.8 ? 'minor' : 'major'

  return { field, input: inputStr, found: foundStr, severity }
}

function authorsToString(authors: { last: string; first: string | null }[]): string {
  return authors.map((a) => (a.first ? `${a.last}, ${a.first}` : a.last)).join('; ')
}

export function findDiscrepancies(
  lookup: LookupResult,
  fieldScores: FieldScores,
): Discrepancy[] {
  const api = lookup.apiData
  if (!api) return []

  const discrepancies: Discrepancy[] = []

  const d = (
    field: string,
    input: string | null | undefined,
    found: string | null | undefined,
    score: number,
  ) => {
    const disc = makeDiscrepancy(field, input, found, score)
    if (disc) discrepancies.push(disc)
  }

  d('author', authorsToString(lookup.authors), authorsToString(api.authors), fieldScores.author)
  d('title', lookup.title, api.title, fieldScores.title)
  // year: score 0.7 means ±1 year (minor), score 0 means ±2+ (major)
  d('year', lookup.year, api.year, fieldScores.year === 0.7 ? 0.85 : fieldScores.year)
  d('journal/publisher', lookup.container, api.container, fieldScores.container)
  d('pages', lookup.pages, api.pages, fieldScores.pages)

  return discrepancies
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function verifyReference(lookup: LookupResult): Promise<VerifiedReference> {
  // Websites and other unresolvable references
  if (!lookup.apiData || lookup.lookupStatus !== 'found') {
    return {
      ...lookup,
      matchScore: 0,
      fieldScores: { author: 0, title: 0, year: 0, container: 0, pages: 0 },
      formattedCitation: null,
      discrepancies: [],
      verificationStatus: scoreToStatus(0, lookup.lookupStatus, lookup.type),
    }
  }

  const fieldScores = scoreReference(lookup, lookup.apiData)
  const matchScore = weightedTotal(fieldScores)
  const verificationStatus = scoreToStatus(matchScore, lookup.lookupStatus, lookup.type)
  const discrepancies = findDiscrepancies(lookup, fieldScores)
  const formattedCitation = await formatChicago(lookup.apiData)

  return {
    ...lookup,
    matchScore,
    fieldScores,
    formattedCitation,
    discrepancies,
    verificationStatus,
  }
}
