// Unit tests for enforceRateLimit + logAIUsageEvent. Mocked supabase
// client; asserts window math, event_type scoping, and the insert
// shape log path.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import {
  enforceRateLimit,
  logAIUsageEvent,
  RateLimitExceededError,
} from '@/lib/rate-limit'

type Client = SupabaseClient<Database>

type ReadResult = {
  data: Array<{ created_at: string }> | null
  error: unknown
}

function makeReadChain(result: ReadResult) {
  const self = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: result.data, error: result.error }),
  } as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    gte: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    then: (r: (v: unknown) => void) => void
  }
  for (const name of ['select', 'eq', 'gte', 'order'] as const) {
    self[name].mockImplementation(() => self)
  }
  return self
}

function makeInsertChain(error: unknown = null) {
  const insert = vi.fn(() => Promise.resolve({ data: null, error }))
  return { insert }
}

function makeClient(readResult: ReadResult, insertError: unknown = null) {
  const readChain = makeReadChain(readResult)
  const insertChain = makeInsertChain(insertError)
  const from = vi.fn(() => ({ ...readChain, ...insertChain }))
  return {
    client: { from } as unknown as Client,
    readChain,
    insertChain,
    from,
  }
}

describe('enforceRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns cleanly when count < limit', async () => {
    const { client } = makeClient({
      data: [
        { created_at: '2026-04-19T11:30:00Z' },
        { created_at: '2026-04-19T11:45:00Z' },
      ],
      error: null,
    })

    await expect(
      enforceRateLimit(client, 'user-1', 'org-1', {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).resolves.toBeUndefined()
  })

  test('returns cleanly when there are zero events in the window', async () => {
    const { client } = makeClient({ data: [], error: null })
    await expect(
      enforceRateLimit(client, 'user-1', 'org-1', {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).resolves.toBeUndefined()
  })

  test('throws RateLimitExceededError when count >= limit with retry computed from oldest', async () => {
    // 5 events in the last hour, oldest at T-3000s. The oldest ages
    // out of the window in 3600 - 3000 = 600s.
    const { client } = makeClient({
      data: [
        { created_at: '2026-04-19T11:10:00Z' }, // 3000s ago -> slot frees in 600s
        { created_at: '2026-04-19T11:30:00Z' },
        { created_at: '2026-04-19T11:45:00Z' },
        { created_at: '2026-04-19T11:55:00Z' },
        { created_at: '2026-04-19T11:59:00Z' },
      ],
      error: null,
    })

    await expect(
      enforceRateLimit(client, 'user-1', 'org-1', {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError)

    try {
      await enforceRateLimit(client, 'user-1', 'org-1', {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitExceededError)
      const rle = err as RateLimitExceededError
      expect(rle.limit).toBe(5)
      // 3000s between oldest and now; slot frees in 3600 - 3000 = 600s.
      expect(rle.retryAfterSeconds).toBe(600)
    }
  })

  test('retry_after is at least 1 second (never zero)', async () => {
    // Oldest event exactly at the window boundary — would age out "now".
    const { client } = makeClient({
      data: Array.from({ length: 5 }, () => ({
        created_at: new Date('2026-04-19T11:00:00.000Z').toISOString(),
      })),
      error: null,
    })

    try {
      await enforceRateLimit(client, 'user-1', 'org-1', {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitExceededError)
      expect((err as RateLimitExceededError).retryAfterSeconds).toBeGreaterThanOrEqual(1)
    }
  })

  test('query scopes by user_id, event_type, and 1-hour window', async () => {
    const { client, readChain } = makeClient({ data: [], error: null })

    await enforceRateLimit(client, 'user-1', 'org-1', {
      eventType: 'status_draft_generate',
      maxPerHour: 5,
    })

    expect(readChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(readChain.eq).toHaveBeenCalledWith('event_type', 'status_draft_generate')
    // 1 hour before frozen now.
    expect(readChain.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-04-19T11:00:00.000Z',
    )
    expect(readChain.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  test('rethrows a non-RateLimitExceededError DB error', async () => {
    const { client } = makeClient({
      data: null,
      error: { message: 'pg exploded', code: 'X' },
    })

    await expect(
      enforceRateLimit(client, 'user-1', 'org-1', {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).rejects.toMatchObject({ message: 'pg exploded' })
  })
})

describe('logAIUsageEvent', () => {
  test('inserts the expected row shape', async () => {
    const { client, insertChain, from } = makeClient({
      data: [],
      error: null,
    })

    await logAIUsageEvent(client, 'user-1', 'org-1', {
      event_type: 'status_draft_generate',
      model: 'narrative',
      tokens_in: 1234,
      tokens_out: 567,
      cost_usd: 0.01,
    })

    expect(from).toHaveBeenCalledWith('ai_usage_events')
    expect(insertChain.insert).toHaveBeenCalledWith({
      organization_id: 'org-1',
      user_id: 'user-1',
      event_type: 'status_draft_generate',
      model: 'narrative',
      tokens_in: 1234,
      tokens_out: 567,
      cost_usd: 0.01,
    })
  })

  test('forwards null token / cost values unchanged (stream mode)', async () => {
    const { client, insertChain } = makeClient({ data: [], error: null })

    await logAIUsageEvent(client, 'user-1', 'org-1', {
      event_type: 'status_draft_generate',
      model: 'narrative',
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
    })

    const payload = (insertChain.insert.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(payload.tokens_in).toBeNull()
    expect(payload.tokens_out).toBeNull()
    expect(payload.cost_usd).toBeNull()
  })

  test('logs to console.error on insert failure but does not throw', async () => {
    const { client } = makeClient({ data: [], error: null }, {
      message: 'pg exploded',
    })
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      logAIUsageEvent(client, 'user-1', 'org-1', {
        event_type: 'status_draft_generate',
        model: 'narrative',
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
      }),
    ).resolves.toBeUndefined()

    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })
})

describe('RateLimitExceededError', () => {
  test('name is RateLimitExceededError and message cites the cap', () => {
    const err = new RateLimitExceededError(5, 600)
    expect(err.name).toBe('RateLimitExceededError')
    expect(err.message).toContain('5')
    expect(err.limit).toBe(5)
    expect(err.retryAfterSeconds).toBe(600)
  })
})
