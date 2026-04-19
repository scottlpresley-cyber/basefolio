// End-to-end tests for enforceRateLimit + logAIUsageEvent against
// the live ai_usage_events table. Each test seeds events via service
// role so we don't have to drive Claude for real, then checks the
// enforcement and isolation behavior through the caller's
// user-scoped client.

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest'
import {
  createTestOrg,
  cleanupOrgs,
  preCleanup,
  serviceClient,
  missingEnv,
  type TestOrg,
} from './fixtures'
import {
  enforceRateLimit,
  logAIUsageEvent,
  RateLimitExceededError,
} from '@/lib/rate-limit'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls/rate-limit] Skipping — missing env: ${missing.join(', ')}`)
}

async function clearEvents(userId: string) {
  const svc = serviceClient()
  await svc.from('ai_usage_events').delete().eq('user_id', userId)
}

// Seeds n events for a user/event_type pair, backdated `offsetSeconds`
// before now for the oldest, evenly spaced to now.
async function seedEvents(
  userId: string,
  orgId: string,
  eventType: 'status_draft_generate' | 'status_assist',
  count: number,
  oldestOffsetSeconds = 60,
) {
  if (count === 0) return
  const svc = serviceClient()
  const now = Date.now()
  const rows = Array.from({ length: count }, (_, i) => {
    const offset = oldestOffsetSeconds - (i * oldestOffsetSeconds) / count
    return {
      organization_id: orgId,
      user_id: userId,
      event_type: eventType,
      model: 'narrative' as const,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      created_at: new Date(now - offset * 1000).toISOString(),
    }
  })
  const { error } = await svc.from('ai_usage_events').insert(rows)
  if (error) throw new Error(`seedEvents: ${error.message}`)
}

describe.skipIf(missing.length > 0)('rate-limit (live RLS)', () => {
  let orgA: TestOrg
  let orgB: TestOrg
  // A second member of orgA, provisioned via service role and moved
  // out of their trigger-created org — used to prove the per-hour
  // cap is per-user, not per-org.
  let secondMemberId: string | null = null
  let secondMemberTriggerOrgId: string | null = null

  beforeAll(async () => {
    await preCleanup()
    orgA = await createTestOrg('rlimit-a')
    orgB = await createTestOrg('rlimit-b')

    const svc = serviceClient()
    const { randomUUID } = await import('node:crypto')
    const { data: created, error } = await svc.auth.admin.createUser({
      email: `rls-test-rlimit-a2-${randomUUID().slice(0, 8)}@basefolio.test`,
      password: `rls-test-password-${randomUUID()}`,
      email_confirm: true,
    })
    if (error || !created.user) throw new Error(`secondMember createUser: ${error?.message}`)
    secondMemberId = created.user.id

    const { data: userRow, error: lookupErr } = await svc
      .from('users')
      .select('organization_id')
      .eq('id', secondMemberId)
      .single()
    if (lookupErr || !userRow) throw new Error(`secondMember lookup: ${lookupErr?.message}`)
    secondMemberTriggerOrgId = userRow.organization_id as string

    await svc
      .from('users')
      .update({ organization_id: orgA.orgId, role: 'member' })
      .eq('id', secondMemberId)
    await svc.from('organizations').delete().eq('id', secondMemberTriggerOrgId)
  }, 60_000)

  afterAll(async () => {
    const orgIds = [orgA?.orgId, orgB?.orgId].filter(Boolean) as string[]
    const userIds = [orgA?.userId, orgB?.userId, secondMemberId].filter(
      Boolean,
    ) as string[]
    await cleanupOrgs(orgIds, userIds)
  }, 60_000)

  beforeEach(async () => {
    // Clean slate per test. Each test's assertions count events
    // scoped by user_id, so we only wipe the test users.
    await clearEvents(orgA.userId)
    await clearEvents(orgB.userId)
    if (secondMemberId) await clearEvents(secondMemberId)
  })

  test('enforces per-user limits — other users in the same org are unaffected', async () => {
    // orgA's primary user is at the cap.
    await seedEvents(orgA.userId, orgA.orgId, 'status_draft_generate', 5)

    await expect(
      enforceRateLimit(orgA.userClient, orgA.userId, orgA.orgId, {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError)

    // The second member of orgA has no events and should pass,
    // even though they share the org. The gate is per-user.
    // Using service role to simulate the second member's session
    // because we didn't spin up a signed-in client for them.
    const svc = serviceClient()
    await expect(
      enforceRateLimit(svc, secondMemberId!, orgA.orgId, {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).resolves.toBeUndefined()
  })

  test('events from other event_types do not count toward the limit', async () => {
    // 10 'status_assist' events (well over the cap), but the check
    // is against 'status_draft_generate' which has none.
    await seedEvents(orgA.userId, orgA.orgId, 'status_assist', 10)

    await expect(
      enforceRateLimit(orgA.userClient, orgA.userId, orgA.orgId, {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).resolves.toBeUndefined()
  })

  test('events older than the 1-hour window do not count', async () => {
    // Seed 10 old events (all > 1 hour ago) + 2 recent.
    const svc = serviceClient()
    const old = Array.from({ length: 10 }, (_, i) => ({
      organization_id: orgA.orgId,
      user_id: orgA.userId,
      event_type: 'status_draft_generate' as const,
      model: 'narrative' as const,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      // 7200-3600*i-ish: all outside the 1-hour window.
      created_at: new Date(Date.now() - (7200 + i * 60) * 1000).toISOString(),
    }))
    await svc.from('ai_usage_events').insert(old)
    await seedEvents(orgA.userId, orgA.orgId, 'status_draft_generate', 2)

    // 2 in-window events; cap is 5. Passes.
    await expect(
      enforceRateLimit(orgA.userClient, orgA.userId, orgA.orgId, {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).resolves.toBeUndefined()
  })

  test('logAIUsageEvent inserts a row the enforce step sees', async () => {
    // Fresh user with 4 events already; one more via logAIUsageEvent
    // pushes them over the cap.
    await seedEvents(orgA.userId, orgA.orgId, 'status_draft_generate', 4)

    await logAIUsageEvent(orgA.userClient, orgA.userId, orgA.orgId, {
      event_type: 'status_draft_generate',
      model: 'narrative',
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
    })

    await expect(
      enforceRateLimit(orgA.userClient, orgA.userId, orgA.orgId, {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError)

    // Confirm the row is visible to the user via RLS (user can read
    // their own org's usage events per the Sprint 2 migration).
    const { data, error } = await orgA.userClient
      .from('ai_usage_events')
      .select('id')
      .eq('user_id', orgA.userId)
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(5)
  })

  test('org isolation: orgA events never count toward orgB limits', async () => {
    // orgA over cap, orgB clean.
    await seedEvents(orgA.userId, orgA.orgId, 'status_draft_generate', 10)

    await expect(
      enforceRateLimit(orgB.userClient, orgB.userId, orgB.orgId, {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      }),
    ).resolves.toBeUndefined()
  })
})
