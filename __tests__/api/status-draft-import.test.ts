// Contract tests for POST /api/status-draft/import. The heavy lifting
// (payload synthesis, owner matching, seeding the anchor update) now
// lives under test in build-project-payload.test.ts and
// bulk-import-projects.test.ts respectively — this file asserts the
// route wires those helpers together correctly and preserves the
// Sprint 1 wire shape { imported, skipped, projectIds }.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'
const TEST_REPORT_ID = '33333333-3333-4333-8333-333333333333'

const mockGetAuthContext = vi.fn()
const mockBulkImportProjects = vi.fn()
const mockListOrgMembers = vi.fn()
const mockStatusReportSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'status_reports') {
        return {
          select: () => ({
            eq: () => ({ single: mockStatusReportSingle }),
          }),
        }
      }
      throw new Error(`unexpected from('${table}')`)
    },
  }),
}))

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
}))

vi.mock('@/lib/projects/mutations', () => ({
  bulkImportProjects: (...args: unknown[]) => mockBulkImportProjects(...args),
}))

vi.mock('@/lib/users/queries', () => ({
  listOrgMembers: (...args: unknown[]) => mockListOrgMembers(...args),
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
    latestDueDate: null,
  }
}

function authed() {
  mockGetAuthContext.mockResolvedValue({
    userId: TEST_USER_ID,
    orgId: TEST_ORG_ID,
    email: 'scott@example.com',
    role: 'owner',
    orgPlan: 'starter',
  })
}

describe('POST /api/status-draft/import', () => {
  beforeEach(() => {
    mockGetAuthContext.mockReset()
    mockBulkImportProjects.mockReset()
    mockListOrgMembers.mockReset()
    mockStatusReportSingle.mockReset()
    mockListOrgMembers.mockResolvedValue([])
  })

  it('happy path: delegates to bulkImportProjects with all the right inputs', async () => {
    authed()
    mockStatusReportSingle.mockResolvedValue({
      data: {
        id: TEST_REPORT_ID,
        content: {
          source: 'ado',
          projects: [
            computedProject('Alpha', 'green'),
            computedProject('Beta', 'yellow'),
            computedProject('Gamma', 'red'),
          ],
          meta: { filename: 'ado-realistic.csv', asOfDate: '2026-04-18' },
        },
        source_file_name: 'ado-realistic.csv',
      },
      error: null,
    })
    mockBulkImportProjects.mockResolvedValue({
      imported: 3,
      skipped: 0,
      projectIds: ['id-1', 'id-2', 'id-3'],
    })

    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      imported: 3,
      skipped: 0,
      projectIds: ['id-1', 'id-2', 'id-3'],
    })

    // Payloads made it through the synthesizer — each has a resolved
    // source + the per-project description the list view will render.
    const [, opts] = mockBulkImportProjects.mock.calls[0] as [
      unknown,
      {
        organizationId: string
        sourceReportId: string
        userId: string
        payloads: Array<{
          project: { name: string; source: string; description: string | null }
        }>
      },
    ]
    expect(opts.organizationId).toBe(TEST_ORG_ID)
    expect(opts.sourceReportId).toBe(TEST_REPORT_ID)
    expect(opts.userId).toBe(TEST_USER_ID)
    expect(opts.payloads).toHaveLength(3)
    expect(opts.payloads[0].project.source).toBe('ado')
    expect(opts.payloads[0].project.name).toBe('Alpha')
    expect(opts.payloads[0].project.description).toContain('items complete')
  })

  it('unknown source in content maps through buildProjectPayload to manual', async () => {
    authed()
    mockStatusReportSingle.mockResolvedValue({
      data: {
        id: TEST_REPORT_ID,
        content: {
          source: 'unknown',
          projects: [computedProject('Alpha')],
        },
        source_file_name: null,
      },
      error: null,
    })
    mockBulkImportProjects.mockResolvedValue({
      imported: 1,
      skipped: 0,
      projectIds: ['id-x'],
    })

    await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    const [, opts] = mockBulkImportProjects.mock.calls[0] as [
      unknown,
      { payloads: Array<{ project: { source: string } }> },
    ]
    expect(opts.payloads[0].project.source).toBe('manual')
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthContext.mockResolvedValue(null)
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(401)
    expect(mockBulkImportProjects).not.toHaveBeenCalled()
  })

  it('returns 400 BAD_REQUEST when reportId missing', async () => {
    authed()
    const res = await POST(buildRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 400 BAD_REQUEST when reportId is not a UUID', async () => {
    authed()
    const res = await POST(buildRequest({ reportId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 404 REPORT_NOT_FOUND when the report is missing or RLS-hidden', async () => {
    authed()
    mockStatusReportSingle.mockResolvedValue({
      data: null,
      error: { message: 'not found' },
    })
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('REPORT_NOT_FOUND')
  })

  it('returns 422 INVALID_REPORT when content.projects is missing or malformed', async () => {
    authed()
    mockStatusReportSingle.mockResolvedValue({
      data: {
        id: TEST_REPORT_ID,
        content: { source: 'ado', projects: 'oops' },
      },
      error: null,
    })
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('INVALID_REPORT')
  })

  it('returns 500 when bulkImportProjects throws', async () => {
    authed()
    mockStatusReportSingle.mockResolvedValue({
      data: {
        id: TEST_REPORT_ID,
        content: {
          source: 'ado',
          projects: [computedProject('Alpha')],
        },
        source_file_name: null,
      },
      error: null,
    })
    mockBulkImportProjects.mockRejectedValue(new Error('pg exploded'))

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL')
    // Client never sees the underlying error message.
    expect(body.error).not.toMatch(/pg exploded/)
    consoleErr.mockRestore()
  })

  it('dedup results from bulkImportProjects pass through to the wire response', async () => {
    authed()
    mockStatusReportSingle.mockResolvedValue({
      data: {
        id: TEST_REPORT_ID,
        content: {
          source: 'jira',
          projects: [
            computedProject('Alpha'),
            computedProject('Beta'),
            computedProject('Gamma'),
          ],
        },
        source_file_name: null,
      },
      error: null,
    })
    mockBulkImportProjects.mockResolvedValue({
      imported: 2,
      skipped: 1,
      projectIds: ['id-beta', 'id-gamma'],
    })

    const res = await POST(buildRequest({ reportId: TEST_REPORT_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      imported: 2,
      skipped: 1,
      projectIds: ['id-beta', 'id-gamma'],
    })
  })
})
