// Unit tests for the getAuthContext helper. We test loadAuthContext
// directly (the implementation behind the React cache wrapper) so
// each assertion targets query shape and shape mapping without
// depending on cache() dedup across test cases.

import { describe, test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { loadAuthContext, getAuthContext } from '@/lib/auth/context'

type Client = SupabaseClient<Database>

function makeUsersQuery(terminal: { data: unknown; error: unknown }) {
  const self = {} as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
  }
  self.select = vi.fn(() => self)
  self.eq = vi.fn(() => self)
  self.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: terminal.data, error: terminal.error }),
  )
  return self
}

function makeClient(user: { id: string; email?: string } | null, usersQuery: ReturnType<typeof makeUsersQuery>): Client {
  return {
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user }, error: null }),
      ),
    },
    from: vi.fn((table: string) => {
      if (table !== 'users') throw new Error(`unexpected from('${table}')`)
      return usersQuery
    }),
  } as unknown as Client
}

describe('loadAuthContext', () => {
  test('returns null when no auth user is present', async () => {
    const q = makeUsersQuery({ data: null, error: null })
    const client = makeClient(null, q)

    const ctx = await loadAuthContext(client)
    expect(ctx).toBeNull()
    // Must short-circuit before touching the DB — no from() call.
    expect((client.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  test('returns null when the users row is missing', async () => {
    const q = makeUsersQuery({ data: null, error: null })
    const client = makeClient({ id: 'u1' }, q)

    const ctx = await loadAuthContext(client)
    expect(ctx).toBeNull()
  })

  test('returns null on DB error', async () => {
    const q = makeUsersQuery({ data: null, error: { message: 'pg exploded', code: 'X' } })
    const client = makeClient({ id: 'u1' }, q)

    const ctx = await loadAuthContext(client)
    expect(ctx).toBeNull()
  })

  test('returns the expected shape when user + users row are present', async () => {
    const q = makeUsersQuery({
      data: {
        organization_id: 'org-1',
        role: 'admin',
        email: 'scott@example.com',
        organizations: { plan: 'team' },
      },
      error: null,
    })
    const client = makeClient({ id: 'u1' }, q)

    const ctx = await loadAuthContext(client)
    expect(ctx).toEqual({
      userId: 'u1',
      orgId: 'org-1',
      email: 'scott@example.com',
      role: 'admin',
      orgPlan: 'team',
    })

    // Join shape: a single query with organizations!inner(plan).
    expect(q.select).toHaveBeenCalledWith(
      'organization_id, role, email, organizations!inner(plan)',
    )
    expect(q.eq).toHaveBeenCalledWith('id', 'u1')
  })

  test("defaults orgPlan to 'starter' when organizations.plan is missing", async () => {
    const q = makeUsersQuery({
      data: {
        organization_id: 'org-2',
        role: 'member',
        email: 'a@b.c',
        organizations: null,
      },
      error: null,
    })
    const client = makeClient({ id: 'u2' }, q)

    const ctx = await loadAuthContext(client)
    expect(ctx?.orgPlan).toBe('starter')
  })
})

describe('getAuthContext (cache wrapper)', () => {
  // React's cache() only memoizes inside a Server Component render
  // tree — outside of that scope (including Vitest) it passes through
  // to the inner function without dedup. We therefore assert the
  // wrapper is exported and returns the same shape as the inner
  // implementation; runtime dedup is exercised in real RSC renders,
  // not in unit tests.
  test('exports the cached wrapper and produces identical results to loadAuthContext', async () => {
    const q = makeUsersQuery({
      data: {
        organization_id: 'org-3',
        role: 'owner',
        email: 'o@b.c',
        organizations: { plan: 'business' },
      },
      error: null,
    })
    const client = makeClient({ id: 'u3' }, q)

    const viaCache = await getAuthContext(client)
    const viaDirect = await loadAuthContext(client)

    expect(viaCache).toEqual(viaDirect)
    expect(viaCache).toEqual({
      userId: 'u3',
      orgId: 'org-3',
      email: 'o@b.c',
      role: 'owner',
      orgPlan: 'business',
    })
  })
})
