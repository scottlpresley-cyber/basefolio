// RLS cross-tenant isolation suite.
//
// Runs two real authenticated sessions against the linked Supabase
// project and proves that User B cannot read, insert, update, or
// delete any of Organization A's rows. Separately proves that
// audit_log and ai_usage_events cannot be UPDATEd or DELETEd even
// within the caller's own org — those tables have no UPDATE/DELETE
// policies, so the RLS engine should deny the operation purely by
// policy absence.
//
// Every deny assertion checks TWO things:
//   1. The client call returned the expected empty result.
//   2. A service-role read-back confirms the database was not mutated.
// A test that only checks "did the call throw" will pass even if RLS
// is completely broken; both halves are required.

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createTestOrg,
  seedOrgData,
  cleanupOrgs,
  preCleanup,
  serviceClient,
  missingEnv,
  HIJACK_SENTINEL,
  SEED_VALUES,
  type TestOrg,
  type SeedData,
} from './fixtures'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls] Skipping RLS suite — missing env vars: ${missing.join(', ')}`)
}

type InsertAttempt = {
  payload: Record<string, unknown>
  readBack: { column: string; value: string | number }
}

type CrossTenantSpec = {
  table:
    | 'projects'
    | 'project_updates'
    | 'milestones'
    | 'risks'
    | 'status_reports'
    | 'audit_log'
    | 'ai_usage_events'
  seedKey: keyof SeedData
  // Field updated in the hijack attempt + the pre-hijack value we
  // expect to still find after the attempt fails.
  updateField: string
  originalValue: string | number
  hijackValue: string | number
  // Builds a payload that would pass NOT NULL + FK if RLS allowed it,
  // so we know the only thing stopping the insert is the WITH CHECK
  // policy. The returned `readBack` tells the verification step which
  // column + value to grep under the target org — 0 rows means the
  // insert really didn't land.
  buildInsertAttempt: (targetOrgId: string, orgBSeed: SeedData) => InsertAttempt
}

const CROSS_TENANT: CrossTenantSpec[] = [
  {
    table: 'projects',
    seedKey: 'projectId',
    updateField: 'name',
    originalValue: SEED_VALUES.projectName,
    hijackValue: HIJACK_SENTINEL,
    buildInsertAttempt: (orgId) => {
      const marker = `rls-inject-projects-${randomUUID()}`
      return { payload: { organization_id: orgId, name: marker }, readBack: { column: 'name', value: marker } }
    },
  },
  {
    table: 'project_updates',
    seedKey: 'projectUpdateId',
    updateField: 'summary',
    originalValue: SEED_VALUES.projectUpdateSummary,
    hijackValue: HIJACK_SENTINEL,
    buildInsertAttempt: (orgId, seed) => {
      const marker = `rls-inject-project_updates-${randomUUID()}`
      return {
        payload: {
          organization_id: orgId,
          project_id: seed.projectId,
          health: 'green',
          summary: marker,
        },
        readBack: { column: 'summary', value: marker },
      }
    },
  },
  {
    table: 'milestones',
    seedKey: 'milestoneId',
    updateField: 'name',
    originalValue: SEED_VALUES.milestoneName,
    hijackValue: HIJACK_SENTINEL,
    buildInsertAttempt: (orgId, seed) => {
      const marker = `rls-inject-milestones-${randomUUID()}`
      return {
        payload: { organization_id: orgId, project_id: seed.projectId, name: marker },
        readBack: { column: 'name', value: marker },
      }
    },
  },
  {
    table: 'risks',
    seedKey: 'riskId',
    updateField: 'description',
    originalValue: SEED_VALUES.riskDescription,
    hijackValue: HIJACK_SENTINEL,
    buildInsertAttempt: (orgId, seed) => {
      const marker = `rls-inject-risks-${randomUUID()}`
      return {
        payload: { organization_id: orgId, project_id: seed.projectId, description: marker },
        readBack: { column: 'description', value: marker },
      }
    },
  },
  {
    table: 'status_reports',
    seedKey: 'statusReportId',
    updateField: 'title',
    originalValue: SEED_VALUES.statusReportTitle,
    hijackValue: HIJACK_SENTINEL,
    buildInsertAttempt: (orgId) => {
      const marker = `rls-inject-status_reports-${randomUUID()}`
      return {
        payload: {
          organization_id: orgId,
          report_type: 'status_draft',
          title: marker,
          content: { marker },
        },
        readBack: { column: 'title', value: marker },
      }
    },
  },
  {
    table: 'audit_log',
    seedKey: 'auditLogId',
    updateField: 'action',
    originalValue: SEED_VALUES.auditLogAction,
    hijackValue: HIJACK_SENTINEL,
    buildInsertAttempt: (orgId) => {
      const marker = `rls-inject-audit_log-${randomUUID()}`
      return {
        payload: { organization_id: orgId, action: marker },
        readBack: { column: 'action', value: marker },
      }
    },
  },
  {
    table: 'ai_usage_events',
    seedKey: 'aiUsageEventId',
    updateField: 'tokens_in',
    originalValue: SEED_VALUES.aiUsageEventTokensIn,
    hijackValue: 999999,
    // event_type and model are CHECK-constrained enums that can't hold
    // a UUID marker. Use a negative sentinel in tokens_in instead —
    // real usage events are always >= 0 so there's no collision.
    buildInsertAttempt: (orgId) => {
      const marker = -Math.floor(1_000_000 + Math.random() * 9_000_000)
      return {
        payload: {
          organization_id: orgId,
          event_type: 'classify',
          model: 'classify',
          tokens_in: marker,
        },
        readBack: { column: 'tokens_in', value: marker },
      }
    },
  },
]

type Ctx = {
  orgA: TestOrg
  orgB: TestOrg
  orgASeed: SeedData
  orgBSeed: SeedData
  svc: SupabaseClient
}

describe.skipIf(missing.length > 0)('RLS cross-tenant isolation', () => {
  const ctx: Partial<Ctx> = {}

  beforeAll(async () => {
    ctx.svc = serviceClient()
    await preCleanup()
    ctx.orgA = await createTestOrg('a')
    ctx.orgB = await createTestOrg('b')
    ctx.orgASeed = await seedOrgData(ctx.orgA.orgId, ctx.orgA.userId)
    ctx.orgBSeed = await seedOrgData(ctx.orgB.orgId, ctx.orgB.userId)
  }, 60_000)

  afterAll(async () => {
    const orgIds = [ctx.orgA?.orgId, ctx.orgB?.orgId].filter(Boolean) as string[]
    const userIds = [ctx.orgA?.userId, ctx.orgB?.userId].filter(Boolean) as string[]
    await cleanupOrgs(orgIds, userIds)
  }, 60_000)

  // ---------------- organizations -------------------------------------
  test('organizations: User B cannot SELECT Org A row', async () => {
    const { orgA, orgB } = ctx as Ctx
    const { data, error } = await orgB.userClient
      .from('organizations')
      .select('id')
      .eq('id', orgA.orgId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // ---------------- users ---------------------------------------------
  test('users: User B cannot SELECT User A row', async () => {
    const { orgA, orgB } = ctx as Ctx
    const { data, error } = await orgB.userClient
      .from('users')
      .select('id, organization_id')
      .eq('id', orgA.userId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // ---------------- cross-tenant CRUD per table -----------------------
  describe.each(CROSS_TENANT)('$table', (spec) => {
    test('User B cannot SELECT Org A rows', async () => {
      const { orgA, orgASeed, orgB } = ctx as Ctx
      const rowId = orgASeed[spec.seedKey]

      // Query by the specific id — RLS on SELECT filters it out so
      // the response is an empty array, not an error.
      const { data, error } = await orgB.userClient
        .from(spec.table)
        .select('id, organization_id')
        .eq('id', rowId)
      expect(error).toBeNull()
      expect(data).toEqual([])

      // Widen the query to catch any policy leak that might expose
      // Org A rows via a broader filter instead of row-by-id.
      const { data: broad, error: broadErr } = await orgB.userClient
        .from(spec.table)
        .select('id, organization_id')
        .eq('organization_id', orgA.orgId)
      expect(broadErr).toBeNull()
      expect(broad).toEqual([])
    })

    test('User B cannot INSERT with Org A organization_id', async () => {
      const { orgA, orgB, orgBSeed, svc } = ctx as Ctx
      const attempt = spec.buildInsertAttempt(orgA.orgId, orgBSeed)

      const { data, error } = await orgB.userClient
        .from(spec.table)
        .insert(attempt.payload)
        .select()

      // RLS WITH CHECK denial on INSERT surfaces as an error with
      // code 42501 and data === null. We assert both.
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
      expect(data).toBeNull()

      // Independent verification: no row with the injected marker
      // exists under Org A. If RLS silently permitted the insert,
      // this read-back would find it.
      const { data: leaked, error: leakErr } = await svc
        .from(spec.table)
        .select('id')
        .eq('organization_id', orgA.orgId)
        .eq(attempt.readBack.column, attempt.readBack.value)
      expect(leakErr).toBeNull()
      expect(leaked).toEqual([])
    })

    test('User B cannot UPDATE Org A rows', async () => {
      const { orgASeed, orgB, svc } = ctx as Ctx
      const rowId = orgASeed[spec.seedKey]

      // RLS USING on UPDATE filters the row from visibility before
      // the update fires — result is data: [], error: null with zero
      // rows affected.
      const { data, error } = await orgB.userClient
        .from(spec.table)
        .update({ [spec.updateField]: spec.hijackValue })
        .eq('id', rowId)
        .select()
      expect(error).toBeNull()
      expect(data).toEqual([])

      // Verify independently that the field was NOT overwritten.
      const { data: after, error: afterErr } = await svc
        .from(spec.table)
        .select(spec.updateField)
        .eq('id', rowId)
        .single()
      expect(afterErr).toBeNull()
      expect(after).not.toBeNull()
      expect((after as unknown as Record<string, unknown>)[spec.updateField]).toBe(spec.originalValue)
    })

    test('User B cannot DELETE Org A rows', async () => {
      const { orgASeed, orgB, svc } = ctx as Ctx
      const rowId = orgASeed[spec.seedKey]

      const { data, error } = await orgB.userClient
        .from(spec.table)
        .delete()
        .eq('id', rowId)
        .select()
      expect(error).toBeNull()
      expect(data).toEqual([])

      // Verify the row still exists.
      const { data: still, error: stillErr } = await svc
        .from(spec.table)
        .select('id')
        .eq('id', rowId)
        .single()
      expect(stillErr).toBeNull()
      expect(still?.id).toBe(rowId)
    })
  })

  // ---------------- audit_log immutability (same-tenant) --------------
  describe('audit_log immutability (same-tenant, by policy absence)', () => {
    test('User B cannot UPDATE their own org audit_log rows', async () => {
      const { orgB, orgBSeed, svc } = ctx as Ctx
      const rowId = orgBSeed.auditLogId

      const { data, error } = await orgB.userClient
        .from('audit_log')
        .update({ action: HIJACK_SENTINEL })
        .eq('id', rowId)
        .select()
      expect(error).toBeNull()
      expect(data).toEqual([])

      const { data: after, error: afterErr } = await svc
        .from('audit_log')
        .select('action')
        .eq('id', rowId)
        .single()
      expect(afterErr).toBeNull()
      expect(after?.action).toBe(SEED_VALUES.auditLogAction)
    })

    test('User B cannot DELETE their own org audit_log rows', async () => {
      const { orgB, orgBSeed, svc } = ctx as Ctx
      const rowId = orgBSeed.auditLogId

      const { data, error } = await orgB.userClient
        .from('audit_log')
        .delete()
        .eq('id', rowId)
        .select()
      expect(error).toBeNull()
      expect(data).toEqual([])

      const { data: still, error: stillErr } = await svc
        .from('audit_log')
        .select('id')
        .eq('id', rowId)
        .single()
      expect(stillErr).toBeNull()
      expect(still?.id).toBe(rowId)
    })
  })

  // ---------------- ai_usage_events immutability (same-tenant) --------
  describe('ai_usage_events immutability (same-tenant, by policy absence)', () => {
    test('User B cannot UPDATE their own org ai_usage_events rows', async () => {
      const { orgB, orgBSeed, svc } = ctx as Ctx
      const rowId = orgBSeed.aiUsageEventId

      const { data, error } = await orgB.userClient
        .from('ai_usage_events')
        .update({ tokens_in: 999999 })
        .eq('id', rowId)
        .select()
      expect(error).toBeNull()
      expect(data).toEqual([])

      const { data: after, error: afterErr } = await svc
        .from('ai_usage_events')
        .select('tokens_in')
        .eq('id', rowId)
        .single()
      expect(afterErr).toBeNull()
      expect(after?.tokens_in).toBe(SEED_VALUES.aiUsageEventTokensIn)
    })

    test('User B cannot DELETE their own org ai_usage_events rows', async () => {
      const { orgB, orgBSeed, svc } = ctx as Ctx
      const rowId = orgBSeed.aiUsageEventId

      const { data, error } = await orgB.userClient
        .from('ai_usage_events')
        .delete()
        .eq('id', rowId)
        .select()
      expect(error).toBeNull()
      expect(data).toEqual([])

      const { data: still, error: stillErr } = await svc
        .from('ai_usage_events')
        .select('id')
        .eq('id', rowId)
        .single()
      expect(stillErr).toBeNull()
      expect(still?.id).toBe(rowId)
    })
  })
})
