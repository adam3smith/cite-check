/** Catalog of Claude models available for AI-assisted checks, with pricing for cost estimates. */
export interface LlmModelInfo {
  id: string
  label: string
  inputPricePerMTok: number
  outputPricePerMTok: number
}

export const LLM_MODELS: LlmModelInfo[] = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest, cheapest)', inputPricePerMTok: 1, outputPricePerMTok: 5 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (balanced — recommended)', inputPricePerMTok: 3, outputPricePerMTok: 15 },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (most capable)', inputPricePerMTok: 5, outputPricePerMTok: 25 },
]

export const DEFAULT_LLM_MODEL = 'claude-sonnet-5'

export function getModelInfo(id: string): LlmModelInfo | undefined {
  return LLM_MODELS.find((m) => m.id === id)
}
