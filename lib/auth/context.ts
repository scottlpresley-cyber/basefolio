// Per-request auth context resolver.
//
// RULE: Always use `supabase.auth.getUser()` in this file — never
// `getSession()`. getSession() reads the session from the cookie
// without hitting Supabase Auth, so a tampered cookie could yield a
// "session" that isn't actually verified. Anything that gates reads
// or writes (which is every use of AuthContext) must verify the JWT.
//
// Memoized via React cache() so multiple callers inside one server
// render (layout + page + child components) share a single round-trip.
// Callers should pass the same client instance each time — dedup is
// keyed on argument identity.

import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { Plan } from '@/lib/stripe/plans'

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export type AuthContext = {
  userId: string
  orgId: string
  email: string
  role: OrgRole
  orgPlan: Plan
}

type Client = SupabaseClient<Database>

// Implementation exported separately from the cached wrapper so unit
// tests can exercise the underlying query shape without colliding with
// React's shared cache across test cases.
export async function loadAuthContext(client: Client): Promise<AuthContext | null> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null

  // Single join — users row + their organization's plan — to keep
  // this one network round-trip regardless of how many callers in
  // the render need pieces of it.
  const { data, error } = await client
    .from('users')
    .select('organization_id, role, email, organizations!inner(plan)')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data) return null

  const orgRow = (data as { organizations?: { plan?: string | null } }).organizations
  const orgPlan = (orgRow?.plan ?? 'starter') as Plan

  return {
    userId: user.id,
    orgId: data.organization_id,
    email: data.email,
    role: data.role as OrgRole,
    orgPlan,
  }
}

export const getAuthContext = cache(loadAuthContext)
