import type Anthropic from '@anthropic-ai/sdk'

/**
 * Loaded lazily so the SDK is never fetched by users who don't supply an API key —
 * keeps the AI-assist feature fully optional without bloating the default bundle.
 */
export async function createAnthropicClient(apiKey: string): Promise<Anthropic> {
  const { default: AnthropicClient } = await import('@anthropic-ai/sdk')
  // The Anthropic API supports direct browser calls via this flag (sends the
  // anthropic-dangerous-direct-browser-access header) — safe here because the
  // user supplies their own key for their own use, same trust model as the
  // Google Books key already handled this way elsewhere in this app.
  return new AnthropicClient({ apiKey, dangerouslyAllowBrowser: true })
}
