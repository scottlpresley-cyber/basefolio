// Integration test for POST /api/projects — exercises the route
// handler against the live Supabase project via two authenticated
// sessions. Confirms RLS wiring end-to-end plus the plan-limit gate.
//
// The handler's internal createClient() is mocked to return a client
// we control per-test. Everything downstream (auth context, RLS on
// inserts, plan counting) uses the real DB.

import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestOrg,
  cleanupOrgs,
  preCleanup,
  serviceClient,
  missingEnv,
  SEED_VALUES,
  type TestOrg,
} from './fixtures'

// This swap must happen before the route module is imported below.
// Vitest hoists vi.mock calls above imports at module load.
let currentClient: SupabaseClient | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => currentClient,
}))

// Import AFTER the mock is registered.
import { POST } from '../../app/api/projects/route'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls/projects-post] Skipping — missing env: ${missing.join(', ')}`)
}

function buildRequest(body: unknown): Request {
  return new Request('http://test.local/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe.skipIf(missing.length > 0)('POST /api/projects (live RLS)', () => {
  let orgA: TestOrg
  let orgB: TestOrg

  beforeAll(async () => {
    await preCleanup()
    orgA = await createTestOrg('post-a')
    orgB = await createTestOrg('post-b')
  }, 60_000)

  afterAll(async () => {
    currentClient = null
    const orgIds = [orgA?.orgId, orgB?.orgId].filter(Boolean) as string[]
    const userIds = [orgA?.userId, orgB?.userId].filter(Boolean) as string[]
    await cleanupOrgs(orgIds, userIds)
  }, 60_000)

  beforeEach(() => {
    currentClient = null
  })

  test('creates a project visible to the caller org only', async () => {
    currentClient = orgA.userClient

    const res = await POST(
      buildRequest({ name: 'rls-post-happy', health: 'green' }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id?: string }
    expect(typeof body.id).toBe('string')
    const createdId = body.id!

    // orgA sees their new project.
    const svc = serviceClient()
    const { data: row, error } = await svc
      .from('projects')
      .select('id, organization_id, name')
      .eq('id', createdId)
      .single()
    expect(error).toBeNull()
    expect(row?.organization_id).toBe(orgA.orgId)
    expect(row?.name).toBe('rls-post-happy')

    // orgB's user client cannot read it.
    const { data: viaB } = await orgB.userClient
      .from('projects')
      .select('id')
      .eq('id', createdId)
    expect(viaB).toEqual([])
  })

  test('ignores a hostile organization_id in the request body', async () => {
    currentClient = orgA.userClient

    const res = await POST(
      buildRequest({
        name: 'rls-post-hijack',
        health: 'green',
        organization_id: orgB.orgId, // hostile client tries to plant under orgB
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }

    // Row actually landed under orgA, not orgB, despite the body.
    const svc = serviceClient()
    const { data: row } = await svc
      .from('projects')
      .select('organization_id')
      .eq('id', body.id)
      .single()
    expect(row?.organization_id).toBe(orgA.orgId)
  })

  test('returns 400 when required fields are missing', async () => {
    currentClient = orgA.userClient

    const res = await POST(buildRequest({ health: 'green' })) // no name
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.name).toBeTruthy()
  })

  test('enforces the starter plan limit (15 projects) with a 402', async () => {
    // Seed orgB directly via service role up to the starter cap, then
    // try to POST one more via orgB's user client. Using orgB so the
    // happy-path orgA rows from earlier tests don't collide with the
    // count.
    const svc = serviceClient()
    const existing = (
      await svc
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgB.orgId)
        .eq('status', 'active')
    ).count ?? 0

    const toInsert = 15 - existing
    if (toInsert > 0) {
      const rows = Array.from({ length: toInsert }, (_, i) => ({
        organization_id: orgB.orgId,
        name: `${SEED_VALUES.projectName}-cap-${i}`,
        owner_id: orgB.userId,
      }))
      const { error } = await svc.from('projects').insert(rows)
      expect(error).toBeNull()
    }

    currentClient = orgB.userClient
    const res = await POST(
      buildRequest({ name: 'should-be-blocked', health: 'green' }),
    )
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      limit: 15,
      plan: 'starter',
    })
    expect(body.current).toBeGreaterThanOrEqual(15)
  }, 60_000)
})
