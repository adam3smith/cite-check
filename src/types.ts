export type ReferenceType = 'journal-article' | 'book' | 'book-chapter' | 'website' | 'other'
export type Confidence = 'high' | 'medium' | 'low'
export type LookupStatus = 'found' | 'not-found' | 'unverifiable' | 'error' | 'pending'
export type LookupSource =
  | 'crossref-doi'
  | 'crossref-search'
  | 'openalex-doi'
  | 'openalex'
  | 'openlibrary'
  | 'google-books'
  | 'url-check'
export type VerificationStatus =
  | 'verified'
  | 'likely-match'
  | 'weak-match'
  | 'not-found'
  | 'unverifiable'

export interface AuthorName {
  last: string
  first: string | null
}

/** Stage 1 output: a single reference entry split from the input list */
export interface RawEntry {
  index: number
  raw: string
  type: ReferenceType
  parseConfidence: Confidence
}

/** Stage 2 output: extracted bibliographic fields */
export interface ParsedReference extends RawEntry {
  authors: AuthorName[]
  year: string | null
  title: string | null
  container: string | null // journal name or publisher
  doi: string | null
  url: string | null
  isbn: string | null
  pages: string | null
  volume: string | null
  issue: string | null
}

/** Normalized work from any API source */
export interface NormalizedWork {
  title: string
  authors: AuthorName[]
  year: string | null
  container: string | null
  doi: string | null
  isbn: string | null
  pages: string | null
  volume: string | null
  issue: string | null
  url: string | null
  type: ReferenceType
  raw: object // original API response preserved
}

/** Stage 3 output: API lookup result */
export interface LookupResult extends ParsedReference {
  lookupStatus: LookupStatus
  lookupSource: LookupSource | null
  apiData: NormalizedWork | null
}

export interface FieldScores {
  author: number
  title: number
  year: number
  container: number
  pages: number
}

export interface Discrepancy {
  field: string
  input: string
  found: string
  severity: 'minor' | 'major'
}

/** Stage 4 output: scored and formatted verification result */
export interface VerifiedReference extends LookupResult {
  matchScore: number
  fieldScores: FieldScores
  formattedCitation: string | null // Chicago 17th from API data
  discrepancies: Discrepancy[]
  verificationStatus: VerificationStatus
  aiCheck?: AiCheckResult | null
}

export type AiCheckVerdict =
  | 'confirmed'
  | 'corrected'
  | 'partially-fabricated'
  | 'likely-fabricated'
  | 'inconclusive'

/** Per-field values the AI found for a "corrected" or "partially-fabricated" verdict */
export interface AiSuggestedFields {
  authors: string | null
  year: string | null
  title: string | null
  container: string | null
  pages: string | null
}

/** Result of an optional LLM-assisted double-check on an unverified reference */
export interface AiCheckResult {
  verdict: AiCheckVerdict
  note: string
  suggestedCitation: string | null
  suggestedFields: AiSuggestedFields | null
  sources: string[]
  model: string
}

// Score thresholds:
// >= 0.90 => verified
// 0.70–0.89 => likely-match
// 0.50–0.69 => weak-match
// < 0.50   => not-found
