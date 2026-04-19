// End-to-end integration test for the project updates data access
// layer (listProjectUpdates + createProjectUpdate) against two real
// authenticated Supabase sessions. Cross-tenant deny coverage on the
// raw table is in cross-tenant-isolation.test.ts; this file focuses
// on positive paths through the helpers and on the project_id
// scoping (one project's feed should never leak into another's).

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupOrgs,
  preCleanup,
  serviceClient,
  missingEnv,
  type TestOrg,
} from './fixtures'
import { createProject } from '@/lib/projects/mutations'
import {
  createProjectUpdate,
} from '@/lib/projects/mutations'
import { listProjectUpdates } from '@/lib/projects/queries'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls/project-updates] Skipping — missing env: ${missing.join(', ')}`)
}

describe.skipIf(missing.length > 0)('project_updates data access layer (live RLS)', () => {
  let orgA: TestOrg
  let orgB: TestOrg

  beforeAll(async () => {
    await preCleanup()
    orgA = await createTestOrg('updates-a')
    orgB = await createTestOrg('updates-b')
  }, 60_000)

  afterAll(async () => {
    const orgIds = [orgA?.orgId, orgB?.orgId].filter(Boolean) as string[]
    const userIds = [orgA?.userId, orgB?.userId].filter(Boolean) as string[]
    await cleanupOrgs(orgIds, userIds)
  }, 60_000)

  test('createProjectUpdate inserts and resolves author_name via the helper join', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-updates-create',
      owner_id: orgA.userId,
    })

    const created = await createProjectUpdate(orgA.userClient, {
      organization_id: orgA.orgId,
      project_id: proj.id,
      author_id: orgA.userId,
      health: 'yellow',
      summary: 'rls-updates-summary',
    })

    expect(created.id).toBeTruthy()
    expect(created.health).toBe('yellow')
    expect(created.project_id).toBe(proj.id)
    expect(created.organization_id).toBe(orgA.orgId)
    // Test users have full_name=null so displayName falls back to
    // the email local-part — same behavior every other consumer sees.
    expect(created.author_name).toBe(orgA.userEmail.split('@')[0])

    // Service-role read-back to confirm the row really landed.
    const svc = serviceClient()
    const { data, error } = await svc
      .from('project_updates')
      .select('id, summary, health, project_id, organization_id, author_id')
      .eq('id', created.id)
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({
      summary: 'rls-updates-summary',
      health: 'yellow',
      project_id: proj.id,
      organization_id: orgA.orgId,
      author_id: orgA.userId,
    })
  })

  test('listProjectUpdates is project-scoped — never leaks between projects in the same org', async () => {
    const projOne = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-updates-feed-1',
      owner_id: orgA.userId,
    })
    const projTwo = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-updates-feed-2',
      owner_id: orgA.userId,
    })

    await createProjectUpdate(orgA.userClient, {
      organization_id: orgA.orgId,
      project_id: projOne.id,
      author_id: orgA.userId,
      health: 'green',
      summary: 'feed-1-only',
    })
    await createProjectUpdate(orgA.userClient, {
      organization_id: orgA.orgId,
      project_id: projTwo.id,
      author_id: orgA.userId,
      health: 'red',
      summary: 'feed-2-only',
    })

    const oneFeed = await listProjectUpdates(orgA.userClient, projOne.id)
    expect(oneFeed.map((u) => u.summary)).toEqual(['feed-1-only'])

    const twoFeed = await listProjectUpdates(orgA.userClient, projTwo.id)
    expect(twoFeed.map((u) => u.summary)).toEqual(['feed-2-only'])
  })

  test('listProjectUpdates returns empty for a different org\'s project', async () => {
    // OrgA's project, with an update on it.
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-updates-cross-org',
      owner_id: orgA.userId,
    })
    await createProjectUpdate(orgA.userClient, {
      organization_id: orgA.orgId,
      project_id: proj.id,
      author_id: orgA.userId,
      health: 'green',
      summary: 'visible-to-a-only',
    })

    // OrgA can read it.
    const fromA = await listProjectUpdates(orgA.userClient, proj.id)
    expect(fromA.map((u) => u.summary)).toContain('visible-to-a-only')

    // OrgB sees nothing — RLS on project_updates filters cross-org rows.
    const fromB = await listProjectUpdates(orgB.userClient, proj.id)
    expect(fromB).toEqual([])
  })

  test('listProjectUpdates orders by created_at desc', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-updates-order',
      owner_id: orgA.userId,
    })

    const first = await createProjectUpdate(orgA.userClient, {
      organization_id: orgA.orgId,
      project_id: proj.id,
      author_id: orgA.userId,
      health: 'green',
      summary: 'first',
    })
    // Tiny delay so the second row is unambiguously newer.
    await new Promise((r) => setTimeout(r, 50))
    const second = await createProjectUpdate(orgA.userClient, {
      organization_id: orgA.orgId,
      project_id: proj.id,
      author_id: orgA.userId,
      health: 'green',
      summary: 'second',
    })

    const feed = await listProjectUpdates(orgA.userClient, proj.id)
    expect(feed[0].id).toBe(second.id)
    expect(feed[1].id).toBe(first.id)
  })
})
