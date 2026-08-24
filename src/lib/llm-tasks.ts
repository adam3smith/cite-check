import type Anthropic from '@anthropic-ai/sdk'
import type { AiCheckResult, AiCheckVerdict, AiSuggestedFields, VerifiedReference } from '../types'
import { createAnthropicClient } from './llm-client'

const FIX_LINE_BREAKS_SYSTEM =
  'You fix line-break artifacts in academic bibliographies pasted from PDFs. Entries are sometimes broken ' +
  'across multiple lines mid-sentence, mid-title, or mid-URL, or have stray page numbers mixed in. Reformat ' +
  'the text so each individual bibliography entry appears on its own line, joining any lines that are really ' +
  'part of the same entry and dropping stray page/row numbers that are not part of any entry. Do not change, ' +
  'add, remove, reorder, or reword anything else — only join or split line breaks. Respond with only the ' +
  'corrected text: no commentary, no headers, no code fences.'

export async function aiFixLineBreaks(apiKey: string, model: string, text: string): Promise<string> {
  const client = await createAnthropicClient(apiKey)
  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    thinking: { type: 'disabled' },
    system: FIX_LINE_BREAKS_SYSTEM,
    messages: [{ role: 'user', content: text }],
  })

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) throw new Error('AI Fix Line Breaks returned no text')
  return textBlock.text.trim()
}

const RECHECK_SYSTEM =
  'You help verify academic citations that an automated pipeline could not confidently match against ' +
  'CrossRef, OpenAlex, OpenLibrary, or Google Books. You have a web_search tool — use it to check whether ' +
  'the cited work actually exists.\n\n' +
  'Given the raw citation text, the pipeline\'s parsed fields, and (if any) the best candidate match the ' +
  'pipeline found, determine one of:\n' +
  '- "confirmed": this is a real, correctly-cited work (it may simply not be indexed in the databases checked)\n' +
  '- "corrected": a real work matching the title exists, and the citation has one small, understandable error ' +
  '(e.g. a typo, the year off by one, a missing subtitle, a slightly wrong page range) — provide the corrected fields\n' +
  '- "partially-fabricated": a real work with a matching or similar title exists, but two or more of ' +
  '{authors, journal/publisher, year, pages} are substantially wrong (different or extra authors, a completely ' +
  'different journal or publisher, a year off by more than one, unrelated page numbers). This pattern — a real ' +
  'title with fabricated surrounding details — is common with hallucinated citations and deserves a stronger flag ' +
  'than "corrected". Use this instead of "corrected" whenever the errors go beyond one small slip, even though the ' +
  'title matches — provide the correct fields so the discrepancy is visible\n' +
  '- "likely-fabricated": you searched and found no evidence this work exists at all\n' +
  '- "inconclusive": you could not determine either way\n\n' +
  'Respond with ONLY a JSON object on a single line, no other text, no code fences, matching exactly this shape ' +
  '(suggestedCitation/suggestedFields are null except for "corrected" and "partially-fabricated" verdicts; within ' +
  'suggestedFields, only include a field if it differs from what was parsed):\n' +
  '{"verdict": "confirmed|corrected|partially-fabricated|likely-fabricated|inconclusive", ' +
  '"note": "one or two sentence explanation", "suggestedCitation": "formatted corrected citation string, or null", ' +
  '"suggestedFields": {"authors": "corrected author string, or null", "year": "corrected year, or null", ' +
  '"title": "corrected title, or null", "container": "corrected journal/publisher, or null", ' +
  '"pages": "corrected pages, or null"} (or null if no fields differ), "sources": ["url", "..."]}'

const VALID_VERDICTS: AiCheckVerdict[] = [
  'confirmed',
  'corrected',
  'partially-fabricated',
  'likely-fabricated',
  'inconclusive',
]

function buildRecheckPrompt(ref: VerifiedReference): string {
  const authors = ref.authors.map((a) => (a.first ? `${a.last}, ${a.first}` : a.last)).join('; ')
  const bestMatch =
    ref.apiData && ref.matchScore > 0
      ? `The pipeline's best candidate match (score ${(ref.matchScore * 100).toFixed(0)}%): "${ref.apiData.title}" ` +
        `(${ref.apiData.year ?? 'unknown year'}), ${ref.apiData.container ?? 'unknown container'}.`
      : 'The pipeline found no candidate match above its acceptance threshold.'

  return [
    `Raw citation as pasted by the user:\n"${ref.raw}"`,
    `Automated parsing extracted: type=${ref.type}, authors="${authors || 'unknown'}", ` +
      `year=${ref.year ?? 'unknown'}, title="${ref.title ?? 'unknown'}", container="${ref.container ?? 'unknown'}".`,
    bestMatch,
    'Determine whether this citation refers to a real, findable work.',
  ].join('\n\n')
}

function parseSuggestedFields(value: unknown): AiSuggestedFields | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const fields: AiSuggestedFields = {
    authors: typeof v.authors === 'string' ? v.authors : null,
    year: typeof v.year === 'string' ? v.year : null,
    title: typeof v.title === 'string' ? v.title : null,
    container: typeof v.container === 'string' ? v.container : null,
    pages: typeof v.pages === 'string' ? v.pages : null,
  }
  const hasAnyField = Object.values(fields).some((f) => f !== null)
  return hasAnyField ? fields : null
}

function parseAiCheckResponse(text: string, model: string): AiCheckResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  const candidate = jsonMatch ? jsonMatch[0] : text
  try {
    const parsed = JSON.parse(candidate)
    const verdict: AiCheckVerdict = VALID_VERDICTS.includes(parsed.verdict) ? parsed.verdict : 'inconclusive'
    return {
      verdict,
      note: typeof parsed.note === 'string' ? parsed.note : '',
      suggestedCitation: typeof parsed.suggestedCitation === 'string' ? parsed.suggestedCitation : null,
      suggestedFields: parseSuggestedFields(parsed.suggestedFields),
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((s: unknown) => typeof s === 'string') : [],
      model,
    }
  } catch {
    return {
      verdict: 'inconclusive',
      note: text.trim().slice(0, 400),
      suggestedCitation: null,
      suggestedFields: null,
      sources: [],
      model,
    }
  }
}

export async function recheckReference(
  apiKey: string,
  model: string,
  ref: VerifiedReference,
): Promise<AiCheckResult> {
  const client = await createAnthropicClient(apiKey)
  const tools = [{ type: 'web_search_20250305' as const, name: 'web_search' as const }]
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildRecheckPrompt(ref) }]

  let response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: RECHECK_SYSTEM,
    tools,
    messages,
  })

  // Server-side web search runs its own iteration loop; resume once or twice if it pauses.
  for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
    messages.push({ role: 'assistant', content: response.content })
    response = await client.messages.create({ model, max_tokens: 2048, system: RECHECK_SYSTEM, tools, messages })
  }

  const textBlock = [...response.content].reverse().find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) {
    return {
      verdict: 'inconclusive',
      note: 'The AI did not return a readable response.',
      suggestedCitation: null,
      suggestedFields: null,
      sources: [],
      model,
    }
  }
  return parseAiCheckResponse(textBlock.text, model)
}

export interface AiFieldRow {
  label: string
  input: string
  found: string
}

/** Build side-by-side input/found rows for the fields the AI flagged as different, for display. */
export function buildAiFieldRows(ref: VerifiedReference): AiFieldRow[] {
  const fields = ref.aiCheck?.suggestedFields
  if (!fields) return []

  const candidates: { key: keyof typeof fields; label: string; input: string }[] = [
    { key: 'title', label: 'title', input: ref.title ?? '' },
    { key: 'authors', label: 'authors', input: ref.authors.map((a) => a.last).join(', ') },
    { key: 'year', label: 'year', input: ref.year ?? '' },
    { key: 'container', label: 'journal/publisher', input: ref.container ?? '' },
    { key: 'pages', label: 'pages', input: ref.pages ?? '' },
  ]

  return candidates
    .filter((c) => fields[c.key])
    .map((c) => ({ label: c.label, input: c.input || '(none parsed)', found: fields[c.key] as string }))
}
