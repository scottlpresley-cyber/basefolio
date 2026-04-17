import Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    'ANTHROPIC_API_KEY is not set. Add it to .env.local (see docs/basefolio-architecture-v1.md section 12).'
  )
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type AIModel = 'narrative' | 'classify'

const MODEL_MAP: Record<AIModel, string> = {
  narrative: 'claude-sonnet-4-6',
  classify: 'claude-haiku-4-5-20251001',
}

export interface ClaudeCallParams {
  model: AIModel
  system: string
  prompt: string
  maxTokens?: number
  stream?: boolean
}

/**
 * Single entry point for all Anthropic SDK calls in the app.
 *
 * @param params.model      'narrative' (Sonnet 4.6) or 'classify' (Haiku 4.5).
 * @param params.system     System prompt string.
 * @param params.prompt     User prompt, sent as a single user turn.
 * @param params.maxTokens  Max output tokens. Default 2000.
 * @param params.stream     When true, returns a MessageStream. Default false.
 *
 * @example Non-streaming
 *   const msg = await callClaude({ model: 'classify', system: 'One word.', prompt: 'Say OK.' })
 *   const text = msg.content.find(b => b.type === 'text')?.text
 *
 * @example Streaming
 *   const stream = await callClaude({ model: 'narrative', system: SYS, prompt: P, stream: true })
 *   for await (const event of stream) { ... }
 */
export async function callClaude(
  params: ClaudeCallParams & { stream: true }
): Promise<MessageStream>
export async function callClaude(
  params: ClaudeCallParams & { stream?: false }
): Promise<Anthropic.Message>
export async function callClaude(
  params: ClaudeCallParams
): Promise<Anthropic.Message | MessageStream> {
  const { model, system, prompt, maxTokens = 2000, stream = false } = params
  const modelId = MODEL_MAP[model]
  try {
    if (stream) {
      return client.messages.stream({
        model: modelId,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      })
    }
    return await client.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const kind =
        err instanceof Anthropic.AuthenticationError
          ? 'auth'
          : err instanceof Anthropic.RateLimitError
            ? 'rate-limit'
            : err instanceof Anthropic.InternalServerError
              ? 'server'
              : 'api'
      throw new Error(
        `Anthropic ${kind} error (status ${err.status ?? 'unknown'}) calling model=${modelId} stream=${stream}: ${err.message}`,
        { cause: err }
      )
    }
    throw err
  }
}
