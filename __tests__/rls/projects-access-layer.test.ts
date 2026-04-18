// End-to-end integration test for the projects data access layer.
// Runs the lib helpers against two real authenticated Supabase
// sessions and confirms the helpers honor per-org RLS. Deny-path
// coverage (User B cannot read/write Org A's rows) is already
// exhaustive in cross-tenant-isolation.test.ts — this file focuses
// on the positive paths through the lib layer itself, plus one
// narrow leak check on listProjects.

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupOrgs,
  preCleanup,
  serviceClient,
  missingEnv,
  type TestOrg,
} from './fixtures'
import {
  listProjects,
  getProject,
  getProjectsBySourceReport,
} from '@/lib/projects/queries'
import { createProject, updateProjectHealth } from '@/lib/projects/mutations'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls/projects] Skipping — missing env: ${missing.join(', ')}`)
}

describe.skipIf(missing.length > 0)('projects data access layer (live RLS)', () => {
  let orgA: TestOrg
  let orgB: TestOrg

  beforeAll(async () => {
    await preCleanup()
    orgA = await createTestOrg('dal-a')
    orgB = await createTestOrg('dal-b')
  }, 60_000)

  afterAll(async () => {
    const orgIds = [orgA?.orgId, orgB?.orgId].filter(Boolean) as string[]
    const userIds = [orgA?.userId, orgB?.userId].filter(Boolean) as string[]
    await cleanupOrgs(orgIds, userIds)
  }, 60_000)

  test('createProject via a user client persists a row under that org', async () => {
    const created = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-dal-create',
      owner_id: orgA.userId,
    })
    expect(created.id).toBeTruthy()
    expect(created.organization_id).toBe(orgA.orgId)
    expect(created.name).toBe('rls-dal-create')
    expect(created.status).toBe('active')
    expect(created.health).toBe('green')

    // Read-back via service role to confirm the row really landed.
    const svc = serviceClient()
    const { data, error } = await svc
      .from('projects')
      .select('id, organization_id, name')
      .eq('id', created.id)
      .single()
    expect(error).toBeNull()
    expect(data?.organization_id).toBe(orgA.orgId)
    expect(data?.name).toBe('rls-dal-create')
  })

  test('listProjects only surfaces the caller org\'s rows', async () => {
    // Seed one project per org via their own clients.
    const projA = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-dal-list-a',
      owner_id: orgA.userId,
    })
    const projB = await createProject(orgB.userClient, {
      organization_id: orgB.orgId,
      name: 'rls-dal-list-b',
      owner_id: orgB.userId,
    })

    const fromA = await listProjects(orgA.userClient)
    const fromAIds = fromA.map((p) => p.id)
    expect(fromAIds).toContain(projA.id)
    expect(fromAIds).not.toContain(projB.id)

    const fromB = await listProjects(orgB.userClient)
    const fromBIds = fromB.map((p) => p.id)
    expect(fromBIds).toContain(projB.id)
    expect(fromBIds).not.toContain(projA.id)
  })

  test('getProject returns null when the row belongs to a different org', async () => {
    const projA = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-dal-get-cross',
      owner_id: orgA.userId,
    })

    // User A sees their own row.
    const hit = await getProject(orgA.userClient, projA.id)
    expect(hit?.id).toBe(projA.id)

    // User B gets null — RLS hides it and getProject surfaces that
    // as null rather than throwing.
    const miss = await getProject(orgB.userClient, projA.id)
    expect(miss).toBeNull()
  })

  test('getProjectsBySourceReport scopes by report_id and respects RLS', async () => {
    // Seed a status_report belonging to orgA so the projects can
    // reference it (RLS on status_reports permits the insert under
    // orgA's own client).
    const { data: report, error: reportErr } = await orgA.userClient
      .from('status_reports')
      .insert({
        organization_id: orgA.orgId,
        created_by: orgA.userId,
        report_type: 'status_draft',
        content: { marker: 'rls-dal-report' },
      })
      .select('id')
      .single()
    expect(reportErr).toBeNull()
    const reportId = report!.id

    const linked = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-dal-report-linked',
      owner_id: orgA.userId,
      source_report_id: reportId,
    })

    // OrgA sees the linked project under that report.
    const fromA = await getProjectsBySourceReport(orgA.userClient, reportId)
    expect(fromA.map((p) => p.id)).toContain(linked.id)

    // OrgB sees an empty list (report_id is real but RLS on projects
    // hides every row under orgA).
    const fromB = await getProjectsBySourceReport(orgB.userClient, reportId)
    expect(fromB).toEqual([])
  })

  test('updateProjectHealth updates the project and writes an audit row', async () => {
    const proj = await createProject(orgA.userClient, {
      organization_id: orgA.orgId,
      name: 'rls-dal-health',
      owner_id: orgA.userId,
    })
    expect(proj.health).toBe('green')

    const { project: updated, auditLogId } = await updateProjectHealth(
      orgA.userClient,
      proj.id,
      'red',
      orgA.userId,
    )
    expect(updated.id).toBe(proj.id)
    expect(updated.health).toBe('red')
    expect(auditLogId).toBeTruthy()

    // Confirm the audit row via service role — the user client can
    // read it too under RLS, but service-role read-back mirrors how
    // we verify cross-tenant tests (independent of the helper).
    const svc = serviceClient()
    const { data: audit, error } = await svc
      .from('audit_log')
      .select('action, entity_type, entity_id, old_value, new_value, user_id, organization_id')
      .eq('id', auditLogId)
      .single()
    expect(error).toBeNull()
    expect(audit).toMatchObject({
      action: 'project.health_changed',
      entity_type: 'project',
      entity_id: proj.id,
      old_value: { health: 'green' },
      new_value: { health: 'red' },
      user_id: orgA.userId,
      organization_id: orgA.orgId,
    })
  })
})
