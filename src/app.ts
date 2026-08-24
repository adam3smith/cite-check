import { parseReferenceList } from './stages/stage1-parse'
import { extractFields, fillRepeatedAuthors } from './stages/stage2-extract'
import { lookupReference, resetGoogleBooksQuota } from './stages/stage3-lookup'
import { verifyReference } from './stages/stage4-verify'
import { initCitationFormat } from './lib/citation-format'
import { resetAllQueues } from './lib/rate-limiter'
import { aiFixLineBreaks as runAiFixLineBreaks, recheckReference } from './lib/llm-tasks'
import { DEFAULT_LLM_MODEL, LLM_MODELS } from './lib/llm-models'
import type { AiCheckVerdict, VerifiedReference, VerificationStatus } from './types'

export type { VerifiedReference, VerificationStatus }
export { LLM_MODELS }

const LLM_KEY_STORAGE = 'citecheck_llm_api_key'
const LLM_MODEL_STORAGE = 'citecheck_llm_model'

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
  isRunning: boolean

  // AI-assist (optional; only active when an API key is supplied)
  llmApiKey: string
  llmModel: string
  aiBusy: boolean
  aiError: string | null
  aiProgressCurrent: number
  aiProgressTotal: number

  // Computed
  readonly verified: VerifiedReference[]
  readonly unverified: VerifiedReference[]
  readonly aiRecheckable: VerifiedReference[]
  readonly unverifiedByStatus: Record<string, VerifiedReference[]>
  readonly total: number
  readonly parsedEntries: { index: number; raw: string }[]
  readonly llmEnabled: boolean
  readonly statusSummary: string
  readonly aiCheckSummary: string
  showPreview: boolean

  // Actions
  run(): Promise<void>
  reset(): void
  fixLineBreaks(): void
  aiFixLineBreaks(): Promise<void>
  aiRecheckAll(): Promise<void>
  copyVerified(): Promise<void>
  exportCSV(): void
  toggleExpand(index: number): void
  saveLlmSettings(): void
}

const STATUS_LABELS: Record<VerificationStatus, string> = {
  'verified': 'Verified',
  'likely-match': 'Likely match (minor discrepancies)',
  'weak-match': 'Weak match (review recommended)',
  'not-found': 'Not found in any database',
  'unverifiable': 'Unverifiable',
}

const STATUS_SUMMARY_ORDER: VerificationStatus[] = [
  'verified',
  'likely-match',
  'weak-match',
  'not-found',
  'unverifiable',
]

const STATUS_SUMMARY_LABELS: Record<VerificationStatus, string> = {
  'verified': 'verified',
  'likely-match': 'likely match',
  'weak-match': 'weak match',
  'not-found': 'not found',
  'unverifiable': 'unverifiable',
}

const AI_VERDICT_SUMMARY_ORDER: AiCheckVerdict[] = [
  'confirmed',
  'corrected',
  'partially-fabricated',
  'likely-fabricated',
  'inconclusive',
]

const AI_VERDICT_SUMMARY_LABELS: Record<AiCheckVerdict, string> = {
  confirmed: 'confirmed',
  corrected: 'corrected',
  'partially-fabricated': 'partially fabricated',
  'likely-fabricated': 'likely fabricated',
  inconclusive: 'inconclusive',
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
    isRunning: false,
    showPreview: false,

    llmApiKey: localStorage.getItem(LLM_KEY_STORAGE) ?? '',
    llmModel: localStorage.getItem(LLM_MODEL_STORAGE) ?? DEFAULT_LLM_MODEL,
    aiBusy: false,
    aiError: null,
    aiProgressCurrent: 0,
    aiProgressTotal: 0,

    get llmEnabled() {
      return this.llmApiKey.trim().length > 0
    },

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

    // Unverified references worth spending an AI Double-Check call on. Excludes
    // 'unverifiable' (mostly website URLs the browser can't confirm either way —
    // a local skill with real network access could just curl these instead).
    get aiRecheckable() {
      return this.unverified.filter((r) => r.verificationStatus !== 'unverifiable')
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

    get statusSummary() {
      const counts: Partial<Record<VerificationStatus, number>> = {}
      for (const ref of this.references) {
        counts[ref.verificationStatus] = (counts[ref.verificationStatus] ?? 0) + 1
      }
      return STATUS_SUMMARY_ORDER
        .filter((s) => counts[s])
        .map((s) => `${counts[s]} ${STATUS_SUMMARY_LABELS[s]}`)
        .join(' · ')
    },

    get aiCheckSummary() {
      const counts: Partial<Record<AiCheckVerdict, number>> = {}
      let total = 0
      for (const ref of this.references) {
        if (!ref.aiCheck) continue
        counts[ref.aiCheck.verdict] = (counts[ref.aiCheck.verdict] ?? 0) + 1
        total++
      }
      if (total === 0) return ''
      return AI_VERDICT_SUMMARY_ORDER
        .filter((v) => counts[v])
        .map((v) => `${counts[v]} ${AI_VERDICT_SUMMARY_LABELS[v]}`)
        .join(' · ')
    },

    get parsedEntries() {
      if (!this.inputText.trim()) return []
      return parseReferenceList(this.inputText)
    },

    async run() {
      // Guard against a second click while a run is already in progress — without this,
      // both invocations reset and push into the same `references` array concurrently,
      // producing duplicate entries (same .index twice) that collide on x-for's :key.
      if (!this.inputText.trim() || this.isRunning) return
      this.isRunning = true
      this.error = null
      this.references = []
      this.progress = 0
      this.expandedIndex = null

      try {
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
        const parsed = fillRepeatedAuthors(rawEntries.map(extractFields))

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
      } finally {
        this.isRunning = false
      }
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
      this.isRunning = false
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

        // Hyphen-continuation: must run before the short-line check so a line like "185."
        // following "…171-" joins as "…171-185." rather than "…171- 185."
        if (/[a-zA-Z]-$/.test(trimmed)) {
          // Letter-hyphen: word break — remove hyphen and join without space
          buffer = trimmed.replace(/-$/, '') + nextTrimmed
          continue
        }
        if (/\d-$/.test(trimmed)) {
          // Digit-hyphen: page-range continuation — keep hyphen and join without space
          buffer = trimmed + nextTrimmed
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

        // Pattern A: current line ends with a 4-digit year + period → continuation
        // (author chain + year, title follows on next line).
        // Excluded: year preceded by comma ("MIT Press, 2015." = Chicago bib year-at-end).
        // Excluded: next line looks like a new reference (would produce a false join).
        if (/\b(1[5-9]\d\d|20\d\d)\.\s*$/.test(trimmed)
            && !/,\s*(1[5-9]\d\d|20\d\d)\.\s*$/.test(trimmed)
            && !nextIsNewRef) {
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
        } else {
          buffer = trimmed + ' ' + nextTrimmed
        }
      }

      if (buffer) result.push(buffer)

      this.inputText = result.join('\n')
    },

    saveLlmSettings() {
      localStorage.setItem(LLM_KEY_STORAGE, this.llmApiKey)
      localStorage.setItem(LLM_MODEL_STORAGE, this.llmModel)
    },

    async aiFixLineBreaks() {
      if (!this.llmEnabled || !this.inputText.trim() || this.aiBusy) return
      this.aiError = null
      this.aiBusy = true
      try {
        this.inputText = await runAiFixLineBreaks(this.llmApiKey, this.llmModel, this.inputText)
      } catch (e) {
        console.error('AI Fix Line Breaks failed:', e)
        this.aiError = 'AI Fix Line Breaks failed — check your API key and try again.'
      } finally {
        this.aiBusy = false
      }
    },

    async aiRecheckAll() {
      if (!this.llmEnabled || this.aiBusy) return
      this.aiError = null
      this.aiBusy = true
      this.aiProgressCurrent = 0
      this.aiProgressTotal = this.aiRecheckable.length
      try {
        for (let i = 0; i < this.references.length; i++) {
          const ref = this.references[i]
          if (
            ref.verificationStatus === 'verified' ||
            ref.verificationStatus === 'likely-match' ||
            ref.verificationStatus === 'unverifiable'
          ) continue
          this.aiProgressCurrent++
          try {
            const aiCheck = await recheckReference(this.llmApiKey, this.llmModel, ref)
            this.references[i] = { ...ref, aiCheck }
          } catch (e) {
            console.error('AI double-check failed for reference:', ref.raw, e)
            this.references[i] = {
              ...ref,
              aiCheck: {
                verdict: 'inconclusive',
                note: 'AI double-check failed for this reference.',
                suggestedCitation: null,
                suggestedFields: null,
                sources: [],
                model: this.llmModel,
              },
            }
          }
        }
      } finally {
        this.aiBusy = false
      }
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
