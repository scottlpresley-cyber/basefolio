// Integration test for PATCH /api/projects/[id] against the live
// DB via two authenticated sessions. Confirms:
//   - Non-health PATCH updates the row and returns auditEntry: null
//   - Health PATCH updates the row AND writes to audit_log
//   - Cross-tenant PATCH collapses to 404, doesn't leak existence
//   - Stripping organization_id from the body holds end-to-end

import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestOrg,
  cleanupOrgs,
  preCleanup,
  serviceClient,
  missingEnv,
  RLS_TEST_EMAIL_DOMAIN,
  RLS_TEST_EMAIL_PREFIX,
  type TestOrg,
} from './fixtures'

// Swap the PATCH handler's internal createClient for a test-supplied
// user-scoped client. vi.mock is hoisted above imports.
let currentClient: SupabaseClient | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => currentClient,
}))

import { PATCH } from '../../app/api/projects/[id]/route'
import { createProject } from '@/lib/projects/mutations'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls/projects-patch] Skipping — missing env: ${missing.join(', ')}`)
}

function buildRequest(projectId: string, body: unknown): Request {
  return new Request(`http://test.local/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe.skipIf(missing.length > 0)('PATCH /api/projects/[id] (live RLS)', () => {
  let orgA: TestOrg
  let orgB: TestOrg
  // A second member of orgA, created by hand. The trigger that
  // provisions a new org on signup always makes the new user the
  // owner of their own org, so we bypass it via service role: create
  // the auth user, then re-point public.users.organization_id to
  // orgA's id. Used by the owner value->value PATCH test.
  let secondMemberId: string | null = null

  beforeAll(async () => {
    await preCleanup()
    orgA = await createTestOrg('patch-a')
    orgB = await createTestOrg('patch-b')

    const svc = serviceClient()
    const email = `${RLS_TEST_EMAIL_PREFIX}patch-a2-${randomUUID().slice(0, 8)}@${RLS_TEST_EMAIL_DOMAIN}`
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email,
      password: `rls-test-password-${randomUUID()}`,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      throw new Error(`second-member createUser failed: ${createErr?.message}`)
    }
    secondMemberId = created.user.id
    // Trigger placed this new user in a fresh org of their own. Grab
    // the trigger-created org so we can delete it in afterAll, then
    // re-point the user's org to orgA.
    const { data: userRow, error: lookupErr } = await svc
      .from('users')
      .select('organization_id')
      .eq('id', secondMemberId)
      .single()
    if (lookupErr || !userRow) {
      throw new Error(`second-member users lookup failed: ${lookupErr?.message}`)
    }
    const triggerOrgId = userRow.organization_id as string
    const { error: moveErr } = await svc
      .from('users')
      .update({ organization_id: orgA.orgId, role: 'member' })
      .eq('id', secondMemberId)
    if (moveErr) throw new Error(`second-member move failed: ${moveErr.message}`)
    // Clean up the now-empty trigger org so preCleanup's heuristic
    // (organizations.name like rls-test-%) catches it even if this
    // afterAll is skipped on a crash.
    await svc.from('organizations').delete().eq('id', triggerOrgId)
  }, 60_000)

  afterAll(async () => {
    currentClient = null
    const orgIds = [orgA?.orgId, orgB?.orgId].filter(Boolean) as string[]
    const userIds = [orgA?.userId, orgB?.userId, secondMemberId].filter(
      Boolean,
    ) as string[]
    await cleanupOrgs(orgIds, userIds)
  }, 60_000)

  beforeEach(() => {
    currentClient = null
  })

  test('non-health patch updates the row and writes no audit entry', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-patch-phase',
      owner_id: orgA.userId,
    })

    currentClient = orgA.userClient
    const res = await PATCH(
      buildRequest(proj.id, { phase: 'Execution' }),
      ctx(proj.id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.phase).toBe('Execution')
    expect(body.auditEntry).toBeNull()

    // Confirm via service role that no audit row was written.
    const svc = serviceClient()
    const { count } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', proj.id)
    expect(count).toBe(0)
  })

  test('health patch updates the row AND writes a project.health_changed audit row', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-patch-health',
      owner_id: orgA.userId,
    })
    expect(proj.health).toBe('green')

    currentClient = orgA.userClient
    const res = await PATCH(
      buildRequest(proj.id, { health: 'yellow' }),
      ctx(proj.id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.health).toBe('yellow')
    expect(body.auditEntry).not.toBeNull()
    expect(body.auditEntry.action).toBe('project.health_changed')
    expect(body.auditEntry.old_value).toEqual({ health: 'green' })
    expect(body.auditEntry.new_value).toEqual({ health: 'yellow' })
    expect(body.auditEntry.actor_name).toBe(orgA.userEmail.split('@')[0])

    // Confirm the audit row actually landed in the DB.
    const svc = serviceClient()
    const { data: audit, error } = await svc
      .from('audit_log')
      .select('action, entity_type, entity_id, organization_id, user_id')
      .eq('id', body.auditEntry.id)
      .single()
    expect(error).toBeNull()
    expect(audit).toMatchObject({
      action: 'project.health_changed',
      entity_type: 'project',
      entity_id: proj.id,
      organization_id: orgA.orgId,
      user_id: orgA.userId,
    })
  })

  test('cross-tenant patch collapses to 404 without mutating the row', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-patch-cross',
      owner_id: orgA.userId,
    })

    currentClient = orgB.userClient
    const res = await PATCH(
      buildRequest(proj.id, { health: 'red' }),
      ctx(proj.id),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('PROJECT_NOT_FOUND')

    // Confirm the row is untouched.
    const svc = serviceClient()
    const { data: after } = await svc
      .from('projects')
      .select('health')
      .eq('id', proj.id)
      .single()
    expect(after?.health).toBe('green')
  })

  test('hostile organization_id in body is ignored (row stays under caller org)', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-patch-hijack',
      owner_id: orgA.userId,
    })

    currentClient = orgA.userClient
    const res = await PATCH(
      buildRequest(proj.id, {
        phase: 'hijacked',
        organization_id: orgB.orgId,
      }),
      ctx(proj.id),
    )
    expect(res.status).toBe(200)

    const svc = serviceClient()
    const { data: after } = await svc
      .from('projects')
      .select('organization_id, phase')
      .eq('id', proj.id)
      .single()
    expect(after?.organization_id).toBe(orgA.orgId)
    expect(after?.phase).toBe('hijacked')
  })

  // These two tests are the ones missing from the original Prompt 7
  // matrix — their absence is how the OwnerEditor commit-on-change
  // bug shipped. The unit-level test covers the route handler in
  // isolation; these two drive the full PATCH round-trip (schema
  // parsing + updateProject + service-role read-back) for each owner
  // transition shape.

  test('PATCH updates owner_id from one value to another (value -> value)', async () => {
    expect(secondMemberId).toBeTruthy()

    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-patch-owner-v2v',
      owner_id: orgA.userId,
    })

    currentClient = orgA.userClient
    const res = await PATCH(
      buildRequest(proj.id, { owner_id: secondMemberId }),
      ctx(proj.id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.owner_id).toBe(secondMemberId)
    expect(body.auditEntry).toBeNull()

    // Confirm via service role that the stored row matches.
    const svc = serviceClient()
    const { data: after, error } = await svc
      .from('projects')
      .select('owner_id')
      .eq('id', proj.id)
      .single()
    expect(error).toBeNull()
    expect(after?.owner_id).toBe(secondMemberId)
  })

  test('PATCH unassigns owner_id when body is explicitly null (value -> null)', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-patch-owner-v2null',
      owner_id: orgA.userId,
    })

    currentClient = orgA.userClient
    const res = await PATCH(
      buildRequest(proj.id, { owner_id: null }),
      ctx(proj.id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.owner_id).toBeNull()
    expect(body.auditEntry).toBeNull()

    const svc = serviceClient()
    const { data: after } = await svc
      .from('projects')
      .select('owner_id')
      .eq('id', proj.id)
      .single()
    expect(after?.owner_id).toBeNull()
  })
})
