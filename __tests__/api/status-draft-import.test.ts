import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'
const TEST_REPORT_ID = '33333333-3333-4333-8333-333333333333'

const mockGetUser = vi.fn()
const mockUserSingle = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

import { POST } from '../../app/api/status-draft/import/route'

function buildRequest(body: unknown, raw = false): Request {
  return new Request('http://test.local/api/status-draft/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

function computedProject(name: string, health = 'green') {
  return {
    name,
    groupingKey: 'area_path',
    itemCount: 3,
    statusCounts: {
      complete: 1,
      in_progress: 1,
      blocked: 0,
      not_started: 1,
      unknown: 0,
    },
    percentComplete: 33,
    overdueCount: 0,
    blockedCount: 0,
    health,
    inferredOwner: null,
    topItems: [],
  }
}

type FromSpec = {
  reportRow?: unknown
  reportError?: unknown
  existingExternalIds?: string[]
  existingError?: unknown
  insertedIds?: string[]
  insertError?: unknown
  capturedInsert?: { rows?: Array<Record<string, unknown>> }
}

function installFromRouter(spec: FromSpec) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({ single: mockUserSingle }),
        }),
      }
    }
    if (table === 'status_reports') {
      return {
        select: () => ({
          eq: () => ({
            single: async () =>
              spec.reportError
                ? { data: null, error: spec.reportError }
                : { data: spec.reportRow ?? null, error: null },
          }),
        }),
      }
    }
    if (table === 'projects') {
      return {
        select: () => {
          // Read path: .select('external_id').eq('organization_id',...).eq('source_report_id',...)
          const eq1 = () => ({
            eq: async () =>
              spec.existingError
                ? { data: null, error: spec.existingError }
                : {
                    data: (spec.existingExternalIds ?? []).map((id) => ({
                      external_id: id,
                    })),
                    error: null,
                  },
          })
          return { eq: eq1 }
        },
        insert: (rows: Array<Record<string, unknown>>) => {
          if (spec.capturedInsert) spec.capturedInsert.rows = rows
          return {
            select: async () =>
              spec.insertError
                ? { data: null, error: spec.insertError }
                : {
                    data: (spec.insertedIds ?? rows.map((_, i) => `new-${i}`)).map(
                      (id) => ({ id }),
                    ),
                    error: null,
                  },
          }
        },
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })
}

function authedDefaults() {
  mockGetUser.mockResolvedValue({ data: { user: { id: TEST_USER_ID } } })
  mockUserSingle.mockResolvedValue({
    data: { organization_id: TEST_ORG_ID },
    error: null,
  })
}

describe('POST /api/status-draft/import', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockUserSingle.mockReset()
    mockFrom.mockReset()
  })

  it('happy path: imports every project when none already exist', async () => {
    authedDefaults()
    const captured: { rows?: Array<Record<string, unknown>> } = {}
    installFromRouter({
      reportRow: {
        id: TEST_REPORT_ID,
        content: {
          source: 'ado',
          projects: [
            computedProject('Alpha', 'green'),
            computedProject('Beta', 'yellow'),
            computedProject('Gamma', 'red'),
          ],
        },
        source_file_name: 'ado-realistic.csv',
      },
      existingExternalIds: [],
      insertedIds: ['id-1', 'id-2', 'id-3'],
      capturedInsert: captured,
    })

    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(3)
    expect(body.skipped).toBe(0)
    expect(body.projectIds).toEqual(['id-1', 'id-2', 'id-3'])
    expect(captured.rows).toHaveLength(3)
    expect(captured.rows?.[0]).toMatchObject({
      organization_id: TEST_ORG_ID,
      name: 'Alpha',
      status: 'active',
      health: 'green',
      source: 'ado',
      external_id: 'Alpha',
      source_report_id: TEST_REPORT_ID,
    })
  })

  it('re-import idempotency: all external_ids already exist, nothing inserted', async () => {
    authedDefaults()
    installFromRouter({
      reportRow: {
        id: TEST_REPORT_ID,
        content: {
          source: 'ado',
          projects: [computedProject('Alpha'), computedProject('Beta')],
        },
      },
      existingExternalIds: ['Alpha', 'Beta'],
    })
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(0)
    expect(body.skipped).toBe(2)
    expect(body.projectIds).toEqual([])
  })

  it('mixed: skips already-imported, inserts the rest', async () => {
    authedDefaults()
    const captured: { rows?: Array<Record<string, unknown>> } = {}
    installFromRouter({
      reportRow: {
        id: TEST_REPORT_ID,
        content: {
          source: 'jira',
          projects: [
            computedProject('Alpha'),
            computedProject('Beta'),
            computedProject('Gamma'),
          ],
        },
      },
      existingExternalIds: ['Alpha'],
      insertedIds: ['id-beta', 'id-gamma'],
      capturedInsert: captured,
    })
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(2)
    expect(body.skipped).toBe(1)
    expect(body.projectIds).toEqual(['id-beta', 'id-gamma'])
    expect(captured.rows?.map((r) => r.name)).toEqual(['Beta', 'Gamma'])
    expect(captured.rows?.[0]?.source).toBe('jira')
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 400 BAD_REQUEST when reportId missing', async () => {
    authedDefaults()
    installFromRouter({})
    const res = await POST(buildRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 400 BAD_REQUEST when reportId is not a UUID', async () => {
    authedDefaults()
    installFromRouter({})
    const res = await POST(buildRequest({ reportId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 404 REPORT_NOT_FOUND when RLS blocks the report read', async () => {
    authedDefaults()
    installFromRouter({ reportRow: null, reportError: { message: 'not found' } })
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('REPORT_NOT_FOUND')
  })

  it('returns 422 INVALID_REPORT when content.projects is missing or malformed', async () => {
    authedDefaults()
    installFromRouter({
      reportRow: {
        id: TEST_REPORT_ID,
        content: { source: 'ado', projects: 'oops' },
      },
    })
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('INVALID_REPORT')
  })

  it('cross-report re-import: same project name under a different reportId inserts a new row', async () => {
    // Simulates the weekly re-import case: "Customer Portal" was imported
    // from report A last week, and this week's report B has a group with
    // the same name. The per-report dedup lookup correctly returns empty
    // for report B, so the insert proceeds — and the DB's partial unique
    // index (org, source_report_id, external_id) permits it.
    authedDefaults()
    const REPORT_A = '44444444-4444-4444-8444-444444444444'
    const REPORT_B = '55555555-5555-4555-8555-555555555555'

    const capturedA: { rows?: Array<Record<string, unknown>> } = {}
    installFromRouter({
      reportRow: {
        id: REPORT_A,
        content: {
          source: 'ado',
          projects: [computedProject('Customer Portal', 'green')],
        },
      },
      existingExternalIds: [],
      insertedIds: ['id-a'],
      capturedInsert: capturedA,
    })
    const resA = await POST(buildRequest({ reportId: REPORT_A }))
    expect(resA.status).toBe(200)
    const bodyA = await resA.json()
    expect(bodyA.imported).toBe(1)
    expect(bodyA.skipped).toBe(0)

    // Re-install for report B. Critically, the per-report existing lookup
    // is scoped by source_report_id = REPORT_B, so it returns empty even
    // though "Customer Portal" already exists under REPORT_A.
    const capturedB: { rows?: Array<Record<string, unknown>> } = {}
    installFromRouter({
      reportRow: {
        id: REPORT_B,
        content: {
          source: 'ado',
          projects: [computedProject('Customer Portal', 'yellow')],
        },
      },
      existingExternalIds: [],
      insertedIds: ['id-b'],
      capturedInsert: capturedB,
    })
    const resB = await POST(buildRequest({ reportId: REPORT_B }))
    expect(resB.status).toBe(200)
    const bodyB = await resB.json()
    expect(bodyB.imported).toBe(1)
    expect(bodyB.skipped).toBe(0)

    // Both inserts captured; same name, different source_report_id.
    expect(capturedA.rows).toHaveLength(1)
    expect(capturedB.rows).toHaveLength(1)
    expect(capturedA.rows?.[0]?.name).toBe('Customer Portal')
    expect(capturedB.rows?.[0]?.name).toBe('Customer Portal')
    expect(capturedA.rows?.[0]?.source_report_id).toBe(REPORT_A)
    expect(capturedB.rows?.[0]?.source_report_id).toBe(REPORT_B)
    expect(capturedA.rows?.[0]?.source_report_id).not.toBe(
      capturedB.rows?.[0]?.source_report_id,
    )
  })
})
