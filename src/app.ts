import { parseReferenceList } from './stages/stage1-parse'
import { extractFields } from './stages/stage2-extract'
import { lookupReference, resetGoogleBooksQuota } from './stages/stage3-lookup'
import { verifyReference } from './stages/stage4-verify'
import { initCitationFormat } from './lib/citation-format'
import { resetAllQueues } from './lib/rate-limiter'
import type { VerifiedReference, VerificationStatus } from './types'

export type { VerifiedReference, VerificationStatus }

type Stage = 0 | 1 | 2 | 3 | 4 | 5

export interface CiteCheckApp {
  // State
  inputText: string
  stage: Stage
  progress: number
  statusMessage: string
  references: VerifiedReference[]
  error: string | null
  expandedIndex: number | null

  // Computed
  readonly verified: VerifiedReference[]
  readonly unverified: VerifiedReference[]
  readonly unverifiedByStatus: Record<string, VerifiedReference[]>
  readonly total: number
  readonly parsedEntries: { index: number; raw: string }[]
  showPreview: boolean

  // Actions
  run(): Promise<void>
  reset(): void
  fixLineBreaks(): void
  copyVerified(): Promise<void>
  exportCSV(): void
  toggleExpand(index: number): void
}

const STATUS_LABELS: Record<VerificationStatus, string> = {
  'verified': 'Verified',
  'likely-match': 'Likely match (minor discrepancies)',
  'weak-match': 'Weak match (review recommended)',
  'not-found': 'Not found in any database',
  'unverifiable': 'Unverifiable',
}

export function citeCheckApp(): CiteCheckApp {
  return {
    inputText: '',
    stage: 0 as Stage,
    progress: 0,
    statusMessage: '',
    references: [],
    error: null,
    expandedIndex: null,
    showPreview: false,

    get verified() {
      return this.references.filter(
        (r) => r.verificationStatus === 'verified' || r.verificationStatus === 'likely-match',
      )
    },

    get unverified() {
      return this.references.filter(
        (r) => r.verificationStatus !== 'verified' && r.verificationStatus !== 'likely-match',
      )
    },

    get unverifiedByStatus() {
      const groups: Record<string, VerifiedReference[]> = {}
      for (const ref of this.unverified) {
        const label = STATUS_LABELS[ref.verificationStatus] ?? ref.verificationStatus
        if (!groups[label]) groups[label] = []
        groups[label].push(ref)
      }
      return groups
    },

    get total() {
      return this.references.length
    },

    get parsedEntries() {
      if (!this.inputText.trim()) return []
      return parseReferenceList(this.inputText)
    },

    async run() {
      if (!this.inputText.trim()) return
      this.error = null
      this.references = []
      this.progress = 0
      this.expandedIndex = null

      try {
        // Init citation.js CSL (no-op if already done)
        await initCitationFormat()
      } catch (e) {
        // Non-fatal: citation formatting will return null, but verification still works
        console.warn('CSL init failed:', e)
      }

      // Stage 1: parse
      this.stage = 1
      this.statusMessage = 'Parsing reference list…'
      const rawEntries = parseReferenceList(this.inputText)
      const total = rawEntries.length

      if (total === 0) {
        this.error = 'No references found. Make sure your reference list is pasted into the text area.'
        this.stage = 0
        return
      }

      // Stage 2: extract
      this.stage = 2
      this.statusMessage = `Extracting fields from ${total} reference${total !== 1 ? 's' : ''}…`
      const parsed = rawEntries.map(extractFields)

      // Stages 3–4: lookup + verify (streamed)
      this.stage = 3
      for (let i = 0; i < parsed.length; i++) {
        const ref = parsed[i]
        this.statusMessage = `Checking reference ${i + 1} of ${total}: ${ref.title ?? ref.raw.slice(0, 60)}…`
        this.progress = Math.round((i / total) * 100)

        try {
          this.stage = 3
          const lookupResult = await lookupReference(ref)
          this.stage = 4
          const verified = await verifyReference(lookupResult)
          this.references.push(verified)
        } catch (e) {
          // On unexpected error, push a not-found entry so the reference isn't silently dropped
          console.error('Error processing reference:', ref.raw, e)
          this.references.push({
            ...ref,
            lookupStatus: 'error',
            lookupSource: null,
            apiData: null,
            matchScore: 0,
            fieldScores: { author: 0, title: 0, year: 0, container: 0, pages: 0 },
            formattedCitation: null,
            discrepancies: [],
            verificationStatus: 'not-found',
          })
        }
      }

      this.progress = 100
      this.stage = 5
      this.statusMessage = `Done. ${this.verified.length} of ${total} references verified.`
    },

    reset() {
      resetAllQueues()
      resetGoogleBooksQuota()
      this.inputText = ''
      this.stage = 0 as Stage
      this.progress = 0
      this.statusMessage = ''
      this.references = []
      this.error = null
      this.expandedIndex = null
      this.showPreview = false
    },

    fixLineBreaks() {
      const lines = this.inputText.split('\n')

      // Step 1: drop lines that are only a number (PDF row numbers / page numbers)
      const filtered = lines.filter((line) => !/^\s*\d+\s*$/.test(line))

      // Step 2: join continuation lines.
      // A line break is "real" when the preceding line ends with a period/sentence-ending
      // punctuation, ends with a complete URL, or the line is blank (reference separator).
      // URL-continuation rules (common in PDF copy-paste):
      //   - Line ending with `-`: never a real break (URLs don't end in hyphens)
      //   - Line ending with `/`: real break only if next line starts with a capital letter
      //     (a URL path ending in / is common, but continuation lines start lowercase)
      // Everything else is a soft wrap and gets joined with a space.
      const result: string[] = []
      let buffer = ''

      for (let i = 0; i < filtered.length; i++) {
        const line = filtered[i]

        if (line.trim() === '') {
          // Blank line: flush buffer and preserve the separator
          if (buffer) { result.push(buffer); buffer = '' }
          result.push('')
          continue
        }

        if (buffer === '') {
          buffer = line
          continue
        }

        const trimmed = buffer.trimEnd()
        const nextTrimmed = line.trimStart()

        // Lines starting with "URL:" always belong to the current reference —
        // check this before any punctuation-based break logic
        if (/^URL:\s*/i.test(nextTrimmed)) {
          buffer = trimmed + ' ' + nextTrimmed
          continue
        }

        // URL fragment checks must come before the short-line check so that
        // broken URL continuations ("aper.", "x.") join without a space.
        const urlFragMatch = trimmed.match(/(https?:\/\/\S*)$/)

        if (urlFragMatch) {
          const frag = urlFragMatch[1]
          if (
            frag.endsWith('-') ||
            ((frag.endsWith('/') || frag.endsWith('.')) && /^[a-z0-9]/.test(nextTrimmed)) ||
            /^_/.test(nextTrimmed) ||  // underscore-continuation (e.g. _Rd.pdf.)
            /^[a-zA-Z0-9]{1,5}\.?$/.test(nextTrimmed)  // short path fragment (e.g. "8." or "x.")
          ) {
            buffer = trimmed + nextTrimmed  // join without space
            continue
          }
          // Complete URL at end of line — real break
          result.push(buffer)
          buffer = line
          continue
        }

        // Next line starts with a URL — it belongs to the current reference
        if (/^https?:\/\//.test(nextTrimmed)) {
          buffer = trimmed + ' ' + nextTrimmed
          continue
        }

        // If the buffer contains a URL (including space-mangled "https: //") and the
        // next line looks like a new author-date reference (Lastname, Firstname), break.
        // Restricted to URL context — otherwise multi-author continuations like
        // "Altman, Michael..." get wrongly split.
        const bufferHasUrl = /https?/i.test(trimmed) || /URL:/i.test(trimmed)
        const nextIsNewRef = /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ][a-zA-ZÀ-ÖØ-öø-ÿ'\-]+(?: [A-Z][a-zA-Z]+)?,\s/.test(nextTrimmed)
        if (bufferHasUrl && nextIsNewRef) {
          result.push(buffer)
          buffer = line
          continue
        }

        // Short next line (≤3 words) that doesn't look like a new reference —
        // join it even if the buffer ends with a period.
        // Catches publisher lines like "Cambridge University Press." after a book title.
        const nextWordCount = nextTrimmed.split(/\s+/).filter(Boolean).length
        if (nextWordCount <= 3 && !nextIsNewRef) {
          buffer = trimmed + ' ' + nextTrimmed
          continue
        }

        // Pattern A: current line ends with a 4-digit year + period → always continuation
        // (author chain + year, title follows on next line)
        if (/\b(1[5-9]\d\d|20\d\d)\.\s*$/.test(trimmed)) {
          buffer = trimmed + ' ' + nextTrimmed
          continue
        }

        // Pattern B: next line starts with a 4-digit year + period/comma → continuation
        // (author chain wrapped, year begins the next line)
        if (/^(1[5-9]\d\d|20\d\d)[.,]\s/.test(nextTrimmed)) {
          buffer = trimmed + ' ' + nextTrimmed
          continue
        }

        // Pattern C: next line has volume-issue notation within first 50 chars → journal continuation
        // e.g. "Comparative Politics 51 (3):" or "Perspectives on Politics 10, 37–55"
        if (/\d+\s*\(\d+\)/.test(nextTrimmed.slice(0, 50)) || /\d+,\s*\d+[–\-]/.test(nextTrimmed.slice(0, 50))) {
          buffer = trimmed + ' ' + nextTrimmed
          continue
        }

        // Pattern D: next line has ≤4 words before a DOI → publisher/journal + DOI continuation
        // e.g. "Cambridge University Press. https://doi.org/10.1017/..."
        // Avoids matching a full new reference like "Smith, J. 2020. Title. https://doi.org/..."
        const wordsBeforeDoi = nextTrimmed.match(/^((?:\S+\s+){0,3}\S+)\s+(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:|10\.\d{4,}\/)/)
        if (wordsBeforeDoi) {
          buffer = trimmed + ' ' + nextTrimmed
          continue
        }

        // Standard logic: sentence-ending punctuation = real break, otherwise soft wrap
        const endsWithPeriod = /[.!?]\s*$/.test(buffer)
        if (endsWithPeriod) {
          result.push(buffer)
          buffer = line
        } else if (/\w-$/.test(trimmed)) {
          // Hyphenated word break: remove the hyphen, join without space
          buffer = trimmed.replace(/-$/, '') + nextTrimmed
        } else {
          buffer = trimmed + ' ' + nextTrimmed
        }
      }

      if (buffer) result.push(buffer)

      this.inputText = result.join('\n')
    },

    async copyVerified() {
      const text = this.verified.map((r) => r.formattedCitation ?? r.raw).join('\n\n')
      await navigator.clipboard.writeText(text)
    },

    exportCSV() {
      const headers = ['Index', 'Status', 'Type', 'Input', 'Formatted Citation', 'Match Score', 'Discrepancies']
      const rows = this.references.map((r) => [
        r.index + 1,
        r.verificationStatus,
        r.type,
        `"${r.raw.replace(/"/g, '""')}"`,
        `"${(r.formattedCitation ?? '').replace(/"/g, '""')}"`,
        r.matchScore.toFixed(2),
        `"${r.discrepancies.map((d) => `${d.field}: ${d.input} → ${d.found}`).join('; ')}"`,
      ])
      const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'cite-check-results.csv'
      a.click()
      URL.revokeObjectURL(url)
    },

    toggleExpand(index: number) {
      this.expandedIndex = this.expandedIndex === index ? null : index
    },
  }
}

// Make statusLabel available to Alpine templates
export function statusLabel(status: VerificationStatus): string {
  return STATUS_LABELS[status] ?? status
}

export function statusBadgeClass(status: VerificationStatus): string {
  switch (status) {
    case 'verified': return 'badge badge-verified'
    case 'likely-match': return 'badge badge-likely'
    case 'weak-match': return 'badge badge-weak'
    case 'not-found': return 'badge badge-notfound'
    case 'unverifiable': return 'badge badge-unverifiable'
    default: return 'badge'
  }
}
