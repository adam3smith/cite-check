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

    if (/^URL:\s*/i.test(nextTrimmed)) {
      buffer = trimmed + ' ' + nextTrimmed
      continue
    }

    const urlFragMatch = trimmed.match(/(https?:\/\/\S*)$/)

    if (urlFragMatch) {
      const frag = urlFragMatch[1]
      if (
        frag.endsWith('-') ||
        ((frag.endsWith('/') || frag.endsWith('.')) && /^[a-z0-9]/.test(nextTrimmed)) ||
        /^_/.test(nextTrimmed) ||
        /^[a-zA-Z0-9]{1,5}\.?$/.test(nextTrimmed)
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

    const bufferHasUrl = /https?/i.test(trimmed) || /URL:/i.test(trimmed)
    const nextIsNewRef = /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ][a-zA-ZÀ-ÖØ-öø-ÿ'\-]+(?: [A-Z][a-zA-Z]+)?,\s/.test(nextTrimmed)
    if (bufferHasUrl && nextIsNewRef) {
      result.push(buffer)
      buffer = line
      continue
    }

    const nextWordCount = nextTrimmed.split(/\s+/).filter(Boolean).length
    if (nextWordCount <= 3 && !nextIsNewRef) {
      buffer = trimmed + ' ' + nextTrimmed
      continue
    }

    if (/\b(1[5-9]\d\d|20\d\d)\.\s*$/.test(trimmed)) {
      buffer = trimmed + ' ' + nextTrimmed
      continue
    }

    if (/^(1[5-9]\d\d|20\d\d)[.,]\s/.test(nextTrimmed)) {
      buffer = trimmed + ' ' + nextTrimmed
      continue
    }

    if (/\d+\s*\(\d+\)/.test(nextTrimmed.slice(0, 50))) {
      buffer = trimmed + ' ' + nextTrimmed
      continue
    }

    const wordsBeforeDoi = nextTrimmed.match(/^((?:\S+\s+){0,3}\S+)\s+(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:|10\.\d{4,}\/)/)
    if (wordsBeforeDoi) {
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

// ── URL: prefix lines ─────────────────────────────────────────────────────────

describe('fixLineBreaks — URL: prefix lines', () => {
  it('joins URL: line to preceding reference even after a period', () => {
    const input = [
      'Arkin, Daniel. 2023. "Hamas attack evokes memories." CNN . (Accessed on December 18, 2023).',
      'URL: https: // www. nbcnews. com/ news/ world/ hamas-attack.',
      'Balcells, Laia. 2012. "The Consequences." Politics and Society .',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('URL:')
    expect(lines[0]).toContain('Arkin')
    expect(lines[1]).toContain('Balcells')
  })

  it('keeps URL block with its reference when next line is a new author', () => {
    const input = [
      'Balcells, Laia. 2012. "The Consequences." Politics and Society .',
      'URL: https: // digital. csic. es/ handle/ 10261/ 58456',
      'Bauer, Regina. 2024. "Narva cafe." Social Media.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Balcells')
    expect(lines[0]).toContain('URL:')
    expect(lines[1]).toContain('Bauer')
  })
})

// ── Next-reference detection ──────────────────────────────────────────────────

describe('fixLineBreaks — next-line new-reference detection', () => {
  it('breaks before Lastname, pattern even without period ending', () => {
    // URL block ends without period; next line is a new reference
    const input = [
      'Arkin, Daniel. 2023. "Hamas." CNN . (Accessed December 18, 2023).',
      'URL: https: // www. nbcnews. com/ news/ hamas-attack-evokes-',
      'memories-holocaust-many-jews-rcna120590',
      'Balcells, Laia. 2012. "Victimization." Politics and Society.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Arkin')
    expect(lines[0]).toContain('memories-holocaust')
    expect(lines[1]).toContain('Balcells')
  })

  it('works with compound last names like De Vries after a URL', () => {
    // nextIsNewRef only applies when buffer contains a URL
    const input = [
      'Balcells, Laia. 2012. "Title." Journal. URL: https://example.com/paper',
      'De Vries, Catherine E. 2020. "Title." Journal.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('De Vries')
  })
})

// ── Short continuation lines (publisher on own line) ─────────────────────────

describe('fixLineBreaks — short continuation lines', () => {
  it('joins a publisher line (≤3 words) to the preceding title line', () => {
    const input = [
      'Beissinger, Mark R. 2002. Nationalist Mobilization and the Collapse of the Soviet State.',
      'Cambridge University Press.',
      'Balcells, Laia. 2012. "Victimization." Politics and Society.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Cambridge University Press')
    expect(lines[0]).toContain('Beissinger')
  })

  it('does not join a short line that looks like a new reference', () => {
    // "Smith, John." is only 2 words but matches author pattern
    const input = [
      'Some text ending with a period.',
      'Smith, John. 2020. "Title." Journal.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
  })
})

// ── Multi-author continuation lines ──────────────────────────────────────────

describe('fixLineBreaks — multi-author continuation', () => {
  it('joins author continuation lines that look like Lastname, Firstname', () => {
    const input = [
      'Coppedge, Michael, John Gerring, Carl Henrik Knutsen, Staffan I. Lindberg, Jan Teorell, David',
      'Altman, Michael Bernhard, Agnes Cornell, M. Steven Fish, Lisa Gastaldi. 2021. "V-Dem."',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n').filter((l) => l.trim())
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Altman')
    expect(lines[0]).toContain('Coppedge')
  })
})

// ── URL broken mid-segment (short alphanumeric continuation) ─────────────────

describe('fixLineBreaks — short URL-path fragment continuation', () => {
  it('joins a standalone digit+period line that is a URL path fragment', () => {
    const input = [
      "'Mapping Police Violence'. 2025. https://airtable.com/appzVzSeINK1S3EVR/shroOenW19l1m3w0H/tblxearKzw8W7ViN",
      '8.',
      'Marlow, Alan. 2000. Title.',
    ].join('\n')
    const result = fixLineBreaks(input)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('tblxearKzw8W7ViN8.')
    expect(lines[1]).toContain('Marlow')
  })

  it('joins underscore-prefixed URL continuation', () => {
    const input = [
      'Redes da Maré. 2026. Title. https://www.redesdamare.org.br/media/downloads/arquivos/Boletim_Segurança_Publica',
      '_Rd.pdf.',
    ].join('\n')
    const result = fixLineBreaks(input)
    expect(result).toBe(
      'Redes da Maré. 2026. Title. https://www.redesdamare.org.br/media/downloads/arquivos/Boletim_Segurança_Publica_Rd.pdf.',
    )
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
