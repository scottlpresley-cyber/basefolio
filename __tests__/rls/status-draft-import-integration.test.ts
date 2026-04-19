// End-to-end integration for the Status Draft import path. Seeds a
// status_reports row with a realistic content blob via service role,
// then drives POST /api/status-draft/import as a live user session
// and verifies the resulting projects + initial updates + dedup +
// cross-tenant behavior against the real DB.

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestOrg,
  cleanupOrgs,
  preCleanup,
  serviceClient,
  missingEnv,
  type TestOrg,
} from './fixtures'

let currentClient: SupabaseClient | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => currentClient,
}))

import { POST } from '../../app/api/status-draft/import/route'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls/import] Skipping — missing env: ${missing.join(', ')}`)
}

function buildRequest(reportId: string): Request {
  return new Request('http://test.local/api/status-draft/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reportId }),
  })
}

// Minimal ComputedProject shape the import route accepts.
function computedProject(
  name: string,
  overrides: {
    health?: 'green' | 'yellow' | 'red'
    inferredOwner?: string | null
    latestDueDate?: string | null
  } = {},
) {
  return {
    name,
    groupingKey: 'area_path',
    itemCount: 5,
    statusCounts: {
      complete: 1,
      in_progress: 2,
      blocked: 1,
      not_started: 1,
      unknown: 0,
    },
    percentComplete: 20,
    overdueCount: 1,
    blockedCount: 1,
    health: overrides.health ?? 'yellow',
    inferredOwner: overrides.inferredOwner ?? null,
    topItems: [],
    latestDueDate: overrides.latestDueDate ?? null,
  }
}

async function seedReport(
  orgId: string,
  userId: string,
  content: Record<string, unknown>,
  sourceFileName: string | null = 'ado-realistic.csv',
): Promise<string> {
  const svc = serviceClient()
  const { data, error } = await svc
    .from('status_reports')
    .insert({
      organization_id: orgId,
      created_by: userId,
      report_type: 'status_draft',
      title: null,
      content,
      source_file_name: sourceFileName,
      project_count:
        typeof content.projects === 'object' &&
        content.projects !== null &&
        Array.isArray(content.projects)
          ? content.projects.length
          : 0,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seed report: ${error?.message}`)
  return data.id as string
}

describe.skipIf(missing.length > 0)(
  'POST /api/status-draft/import (live RLS)',
  () => {
    let orgA: TestOrg
    let orgB: TestOrg

    beforeAll(async () => {
      await preCleanup()
      orgA = await createTestOrg('import-a')
      orgB = await createTestOrg('import-b')
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

    test('happy path: populates source, description, phase, target_end_date, and seeds the anchor update', async () => {
      const reportId = await seedReport(orgA.orgId, orgA.userId, {
        source: 'ado',
        projects: [
          computedProject(`rls-import-${randomUUID().slice(0, 6)}-alpha`, {
            health: 'green',
            inferredOwner: null,
            latestDueDate: '2026-07-01',
          }),
        ],
      })

      currentClient = orgA.userClient
      const res = await POST(buildRequest(reportId))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.imported).toBe(1)
      expect(body.skipped).toBe(0)
      expect(body.projectIds).toHaveLength(1)

      const svc = serviceClient()
      const { data: row, error } = await svc
        .from('projects')
        .select('source, description, phase, target_end_date, health, status')
        .eq('id', body.projectIds[0])
        .single()
      expect(error).toBeNull()
      // The key Sprint 2 Prompt 8 guarantees:
      expect(row?.source).toBe('ado') // not null
      expect(row?.description).toContain('items complete')
      expect(row?.phase).toBe('Execution') // 20% complete -> Execution
      expect(row?.target_end_date).toBe('2026-07-01')
      expect(row?.health).toBe('green')
      expect(row?.status).toBe('active')

      // Anchor update got seeded by the importing user.
      const { data: updates } = await svc
        .from('project_updates')
        .select('author_id, health, summary')
        .eq('project_id', body.projectIds[0])
      expect(updates).toHaveLength(1)
      expect(updates?.[0].author_id).toBe(orgA.userId)
      expect(updates?.[0].health).toBe('green')
      expect(updates?.[0].summary).toMatch(/^Imported from /)
    })

    test('owner match: inferredOwner email resolves to a real users.id when present', async () => {
      // orgA's own user has email 'rls-test-import-a-...@basefolio.test'.
      // Passing that exact email as inferredOwner should pin owner_id.
      const reportId = await seedReport(orgA.orgId, orgA.userId, {
        source: 'ado',
        projects: [
          computedProject(`rls-import-${randomUUID().slice(0, 6)}-owned`, {
            inferredOwner: orgA.userEmail,
          }),
        ],
      })

      currentClient = orgA.userClient
      const res = await POST(buildRequest(reportId))
      expect(res.status).toBe(200)
      const body = await res.json()

      const svc = serviceClient()
      const { data: row } = await svc
        .from('projects')
        .select('owner_id')
        .eq('id', body.projectIds[0])
        .single()
      expect(row?.owner_id).toBe(orgA.userId)
    })

    test('owner no-match: unknown inferredOwner leaves owner_id null (no user creation)', async () => {
      const reportId = await seedReport(orgA.orgId, orgA.userId, {
        source: 'ado',
        projects: [
          computedProject(`rls-import-${randomUUID().slice(0, 6)}-orphan`, {
            inferredOwner: 'stranger@nowhere.example',
          }),
        ],
      })

      currentClient = orgA.userClient
      const res = await POST(buildRequest(reportId))
      expect(res.status).toBe(200)
      const body = await res.json()

      const svc = serviceClient()
      const { data: row } = await svc
        .from('projects')
        .select('owner_id')
        .eq('id', body.projectIds[0])
        .single()
      expect(row?.owner_id).toBeNull()
    })

    test('re-import dedup: second import of the same report returns imported: 0, skipped: N', async () => {
      const alpha = `rls-import-${randomUUID().slice(0, 6)}-dup-a`
      const beta = `rls-import-${randomUUID().slice(0, 6)}-dup-b`
      const reportId = await seedReport(orgA.orgId, orgA.userId, {
        source: 'jira',
        projects: [
          computedProject(alpha, { health: 'green' }),
          computedProject(beta, { health: 'yellow' }),
        ],
      })

      currentClient = orgA.userClient
      const first = await POST(buildRequest(reportId))
      expect(first.status).toBe(200)
      const firstBody = await first.json()
      expect(firstBody.imported).toBe(2)

      // Second hit on the same report: partial unique index blocks
      // re-inserts; the per-report lookup catches them first.
      currentClient = orgA.userClient
      const second = await POST(buildRequest(reportId))
      expect(second.status).toBe(200)
      const secondBody = await second.json()
      expect(secondBody).toEqual({
        imported: 0,
        skipped: 2,
        projectIds: [],
      })
    })

    test('cross-tenant: user B cannot import from user A status_report (404, no rows inserted)', async () => {
      const reportId = await seedReport(orgA.orgId, orgA.userId, {
        source: 'ado',
        projects: [
          computedProject(`rls-import-${randomUUID().slice(0, 6)}-xt`),
        ],
      })

      currentClient = orgB.userClient
      const res = await POST(buildRequest(reportId))
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.code).toBe('REPORT_NOT_FOUND')

      // Confirm nothing leaked under orgB via service role.
      const svc = serviceClient()
      const { count } = await svc
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('source_report_id', reportId)
        .eq('organization_id', orgB.orgId)
      expect(count ?? 0).toBe(0)
    })
  },
)
