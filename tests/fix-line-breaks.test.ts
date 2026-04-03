import { describe, it, expect } from 'vitest'

/**
 * Extracted from app.ts fixLineBreaks() so it can be unit-tested.
 * Keep in sync with the implementation in src/app.ts.
 */
function fixLineBreaks(input: string): string {
  const lines = input.split('\n')
  const filtered = lines.filter((line) => !/^\s*\d+\s*$/.test(line))

  const result: string[] = []
  let buffer = ''

  for (let i = 0; i < filtered.length; i++) {
    const line = filtered[i]

    if (line.trim() === '') {
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

    const urlFragMatch = trimmed.match(/(https?:\/\/\S*)$/)

    if (urlFragMatch) {
      const frag = urlFragMatch[1]
      if (
        frag.endsWith('-') ||
        ((frag.endsWith('/') || frag.endsWith('.')) && /^[a-z0-9]/.test(nextTrimmed))
      ) {
        buffer = trimmed + nextTrimmed
        continue
      }
      result.push(buffer)
      buffer = line
      continue
    }

    if (/^https?:\/\//.test(nextTrimmed)) {
      buffer = trimmed + ' ' + nextTrimmed
      continue
    }

    const endsWithPeriod = /[.!?]\s*$/.test(buffer)
    if (endsWithPeriod) {
      result.push(buffer)
      buffer = line
    } else {
      buffer = trimmed + ' ' + nextTrimmed
    }
  }

  if (buffer) result.push(buffer)
  return result.join('\n')
}

// ── URL broken after period (j.\naper. pattern) ───────────────────────────────

describe('fixLineBreaks — URL broken after period before lowercase', () => {
  it('joins j.\\naper. style DOI continuation', () => {
    const input = [
      'Anderson, C., 2019. Environmental priorities. Asia Pac. Environ. Rev. 21, 75–89. https://doi.org/10.1016/j.',
      'aper.2019.00075.',
    ].join('\n')
    const result = fixLineBreaks(input)
    expect(result).toBe(
      'Anderson, C., 2019. Environmental priorities. Asia Pac. Environ. Rev. 21, 75–89. https://doi.org/10.1016/j.aper.2019.00075.',
    )
  })

  it('does NOT join when period is followed by a capital (real sentence break)', () => {
    const input = [
      'First reference. https://doi.org/10.1016/j.suin.2019.113.',
      'Second reference.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('j.suin.2019.113.')
    expect(lines[1]).toBe('Second reference.')
  })
})

// ── URL on its own line (soft-wrapped after sentence period) ──────────────────

describe('fixLineBreaks — URL wrapped onto next line', () => {
  it('joins URL-only continuation line to preceding reference', () => {
    const input = [
      'Allan, J., Jones, M., 2019b. Integrating environmental safeguards into cross-border',
      'infrastructure: lessons from the Mekong basin. J. Sustain. Infrastruct. 27, 113–127.',
      'https://doi.org/10.1016/j.suin.2019.113.',
    ].join('\n')
    const result = fixLineBreaks(input)
    expect(result).toBe(
      'Allan, J., Jones, M., 2019b. Integrating environmental safeguards into cross-border infrastructure: lessons from the Mekong basin. J. Sustain. Infrastruct. 27, 113–127. https://doi.org/10.1016/j.suin.2019.113.',
    )
  })
})

// ── URL broken after hyphen ───────────────────────────────────────────────────

describe('fixLineBreaks — URL broken after hyphen', () => {
  it('joins DOI broken after hyphen', () => {
    const input = [
      'Bounnavong, S., 2020. Impact of upland deforestation. J. Environ. Dev. Sustain. 22, 311–326. https://doi.org/10.1007/s10668-019-00388-',
      'x.',
    ].join('\n')
    const result = fixLineBreaks(input)
    expect(result).toBe(
      'Bounnavong, S., 2020. Impact of upland deforestation. J. Environ. Dev. Sustain. 22, 311–326. https://doi.org/10.1007/s10668-019-00388-x.',
    )
  })
})

// ── URL broken after slash ────────────────────────────────────────────────────

describe('fixLineBreaks — URL broken after slash', () => {
  it('joins DOI broken after slash before digits', () => {
    const input = [
      'Allan, J., Jones, M., 2019a. Environmental cooperation. J. Environ. Policy 44, 129–147. https://',
      'doi.org/10.1016/j.jep.2019.02.004.',
    ].join('\n')
    const result = fixLineBreaks(input)
    expect(result).toBe(
      'Allan, J., Jones, M., 2019a. Environmental cooperation. J. Environ. Policy 44, 129–147. https://doi.org/10.1016/j.jep.2019.02.004.',
    )
  })

  it('does NOT join slash-ending URL when next line starts with capital', () => {
    const input = [
      'Reference one. https://example.com/path/',
      'Reference two starts here.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
  })
})

// ── Row number stripping ──────────────────────────────────────────────────────

describe('fixLineBreaks — row number stripping', () => {
  it('removes standalone number lines', () => {
    const input = 'First reference.\n1\n2\n3\nSecond reference.'
    const result = fixLineBreaks(input)
    expect(result).not.toMatch(/\n\d+\n/)
  })
})
