import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VerifiedReference } from '../src/types'

const createMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMock }
  },
}))

import { aiFixLineBreaks, recheckReference, buildAiFieldRows } from '../src/lib/llm-tasks'

function makeRef(overrides: Partial<VerifiedReference> = {}): VerifiedReference {
  return {
    index: 0,
    raw: 'Nonexistent, A. 2099. "A Fabricated Study." Journal of Nothing 1 (1): 1–2.',
    type: 'journal-article',
    parseConfidence: 'high',
    authors: [{ last: 'Nonexistent', first: 'A' }],
    year: '2099',
    title: 'A Fabricated Study',
    container: 'Journal of Nothing',
    doi: null,
    url: null,
    isbn: null,
    pages: '1-2',
    volume: '1',
    issue: '1',
    lookupStatus: 'not-found',
    lookupSource: null,
    apiData: null,
    matchScore: 0,
    fieldScores: { author: 0, title: 0, year: 0, container: 0, pages: 0 },
    formattedCitation: null,
    discrepancies: [],
    verificationStatus: 'not-found',
    ...overrides,
  }
}

beforeEach(() => {
  createMock.mockReset()
})

describe('aiFixLineBreaks', () => {
  it('returns the trimmed text content from the response', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '  Fixed reference list.\nSecond entry.  ' }],
    })
    const result = await aiFixLineBreaks('sk-ant-test', 'claude-sonnet-5', 'raw input')
    expect(result).toBe('Fixed reference list.\nSecond entry.')
  })

  it('throws when the response has no text block', async () => {
    createMock.mockResolvedValue({ content: [] })
    await expect(aiFixLineBreaks('sk-ant-test', 'claude-sonnet-5', 'raw input')).rejects.toThrow()
  })
})

describe('recheckReference', () => {
  it('parses a well-formed JSON verdict', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: '{"verdict": "likely-fabricated", "note": "No matching work found.", "suggestedCitation": null, "sources": []}',
        },
      ],
    })
    const result = await recheckReference('sk-ant-test', 'claude-sonnet-5', makeRef())
    expect(result).toEqual({
      verdict: 'likely-fabricated',
      note: 'No matching work found.',
      suggestedCitation: null,
      suggestedFields: null,
      sources: [],
      model: 'claude-sonnet-5',
    })
  })

  it('parses a partially-fabricated verdict with suggested fields', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            verdict: 'partially-fabricated',
            note: 'Title matches a real article, but authors, journal, and pages are all wrong.',
            suggestedCitation: 'van Dijk, Jan, John van Kesteren, and Pat Mayhew. 2014. International Review of Victimology 20(1):49-69.',
            suggestedFields: {
              authors: 'van Dijk, Jan; van Kesteren, John; Mayhew, Pat',
              year: null,
              title: null,
              container: 'International Review of Victimology',
              pages: '49-69',
            },
            sources: ['https://example.com/article'],
          }),
        },
      ],
    })
    const result = await recheckReference('sk-ant-test', 'claude-sonnet-5', makeRef())
    expect(result.verdict).toBe('partially-fabricated')
    expect(result.suggestedFields).toEqual({
      authors: 'van Dijk, Jan; van Kesteren, John; Mayhew, Pat',
      year: null,
      title: null,
      container: 'International Review of Victimology',
      pages: '49-69',
    })
  })

  it('treats an all-null suggestedFields object as no suggestion', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: '{"verdict": "confirmed", "note": "Correct as cited.", "suggestedFields": {"authors": null, "year": null, "title": null, "container": null, "pages": null}, "sources": []}',
        },
      ],
    })
    const result = await recheckReference('sk-ant-test', 'claude-sonnet-5', makeRef())
    expect(result.suggestedFields).toBeNull()
  })

  it('extracts JSON embedded in surrounding text', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: 'Here is my finding:\n{"verdict": "confirmed", "note": "Real work, just not indexed.", "suggestedCitation": null, "sources": ["https://example.com"]}',
        },
      ],
    })
    const result = await recheckReference('sk-ant-test', 'claude-sonnet-5', makeRef())
    expect(result.verdict).toBe('confirmed')
    expect(result.sources).toEqual(['https://example.com'])
  })

  it('falls back to inconclusive on unparseable output', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I am not sure how to answer this.' }],
    })
    const result = await recheckReference('sk-ant-test', 'claude-sonnet-5', makeRef())
    expect(result.verdict).toBe('inconclusive')
    expect(result.suggestedCitation).toBeNull()
    expect(result.sources).toEqual([])
  })

  it('falls back to inconclusive on an unrecognized verdict value', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"verdict": "maybe", "note": "unclear"}' }],
    })
    const result = await recheckReference('sk-ant-test', 'claude-sonnet-5', makeRef())
    expect(result.verdict).toBe('inconclusive')
  })

  it('resumes once when the server tool loop pauses', async () => {
    createMock
      .mockResolvedValueOnce({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'still searching' }] })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"verdict": "confirmed", "note": "Found it.", "suggestedCitation": null, "sources": []}' }],
      })
    const result = await recheckReference('sk-ant-test', 'claude-sonnet-5', makeRef())
    expect(createMock).toHaveBeenCalledTimes(2)
    expect(result.verdict).toBe('confirmed')
  })
})

describe('buildAiFieldRows', () => {
  it('returns no rows when there is no aiCheck', () => {
    expect(buildAiFieldRows(makeRef())).toEqual([])
  })

  it('returns no rows when suggestedFields is null', () => {
    const ref = makeRef({
      aiCheck: {
        verdict: 'confirmed',
        note: 'Fine as is.',
        suggestedCitation: null,
        suggestedFields: null,
        sources: [],
        model: 'claude-sonnet-5',
      },
    })
    expect(buildAiFieldRows(ref)).toEqual([])
  })

  it('only includes fields the AI flagged as different, with input pulled from the parsed reference', () => {
    const ref = makeRef({
      authors: [{ last: 'Nonexistent', first: 'A' }],
      container: 'Journal of Nothing',
      pages: '1-2',
      aiCheck: {
        verdict: 'partially-fabricated',
        note: 'Authors and journal are wrong.',
        suggestedCitation: null,
        suggestedFields: {
          authors: 'Real, Author',
          year: null,
          title: null,
          container: 'Real Journal',
          pages: null,
        },
        sources: [],
        model: 'claude-sonnet-5',
      },
    })
    const rows = buildAiFieldRows(ref)
    expect(rows).toEqual([
      { label: 'authors', input: 'Nonexistent', found: 'Real, Author' },
      { label: 'journal/publisher', input: 'Journal of Nothing', found: 'Real Journal' },
    ])
  })

  it('shows a placeholder when the input side was never parsed', () => {
    const ref = makeRef({
      container: null,
      aiCheck: {
        verdict: 'corrected',
        note: 'Container was missing.',
        suggestedCitation: null,
        suggestedFields: { authors: null, year: null, title: null, container: 'Some Journal', pages: null },
        sources: [],
        model: 'claude-sonnet-5',
      },
    })
    const rows = buildAiFieldRows(ref)
    expect(rows).toEqual([{ label: 'journal/publisher', input: '(none parsed)', found: 'Some Journal' }])
  })
})
