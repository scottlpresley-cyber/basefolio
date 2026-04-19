// Fine-grained per-user rate limiting for AI-backed routes. The
// Anthropic spend cap is the hard backstop; this module is the
// per-user gate that stops abuse well before the backstop triggers.
//
// Storage: ai_usage_events table (Sprint 2 migration). Each call to
// enforceRateLimit queries the caller's recent events; each
// successful AI call is logged via logAIUsageEvent AFTER the call
// completes. A failed Claude call does NOT count against the user's
// limit — the goal is to cap successful AI work, not to punish
// users for Anthropic errors.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Client = SupabaseClient<Database>

export type RateLimitEventType = 'status_draft_generate' | 'status_assist'

export type RateLimitConfig = {
  eventType: RateLimitEventType
  maxPerHour: number
}

const WINDOW_MS = 60 * 60 * 1000 // 1 hour

export class RateLimitExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly retryAfterSeconds: number,
  ) {
    super(`Rate limit exceeded: ${limit}/hour`)
    this.name = 'RateLimitExceededError'
  }
}

// Throws RateLimitExceededError with a retry_after_seconds computed
// from the oldest event in the caller's 1-hour window. Returns
// cleanly when the caller is under the cap.
//
// orgId is accepted so a future variant can enforce org-level caps;
// today the query is user-scoped because user-level is the honest
// unit of abuse.
export async function enforceRateLimit(
  client: Client,
  userId: string,
  _orgId: string,
  config: RateLimitConfig,
): Promise<void> {
  void _orgId
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString()

  const { data, error } = await client
    .from('ai_usage_events')
    .select('created_at')
    .eq('user_id', userId)
    .eq('event_type', config.eventType)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: true })
  if (error) throw error

  const events = data ?? []
  if (events.length < config.maxPerHour) return

  // At or over the cap. retry_after_seconds is the time until the
  // OLDEST in-window event ages out — that's when a slot frees up.
  const oldest = new Date(events[0].created_at as string).getTime()
  const ageOutAt = oldest + WINDOW_MS
  const retryAfterMs = ageOutAt - Date.now()
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))

  throw new RateLimitExceededError(config.maxPerHour, retryAfterSeconds)
}

export type AIUsageEventType =
  | 'status_draft_generate'
  | 'narrative'
  | 'classify'
  | 'status_assist'

export type AIUsageEventInput = {
  event_type: AIUsageEventType
  model: 'narrative' | 'classify' | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
}

// Appends a row to ai_usage_events. The caller invokes this AFTER a
// successful AI call so Anthropic errors don't count toward the
// user's quota. tokens_in/out and cost_usd can be null when the
// caller can't compute them cheaply — stream mode in particular
// doesn't give a clean total.
export async function logAIUsageEvent(
  client: Client,
  userId: string,
  orgId: string,
  event: AIUsageEventInput,
): Promise<void> {
  const { error } = await client.from('ai_usage_events').insert({
    organization_id: orgId,
    user_id: userId,
    event_type: event.event_type,
    model: event.model,
    tokens_in: event.tokens_in,
    tokens_out: event.tokens_out,
    cost_usd: event.cost_usd,
  })
  if (error) {
    // Logging is best-effort — a failure to record usage must not
    // cascade into a user-visible error on a successful AI call.
    console.error('logAIUsageEvent: insert failed', error)
  }
}
