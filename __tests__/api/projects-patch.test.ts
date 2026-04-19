// Unit tests for PATCH /api/projects/[id]. Mocks the auth context,
// getProject, and the two mutation helpers; asserts the contract
// and the health vs. non-health branching.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'
const TEST_PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const TEST_OTHER_ORG_ID = 'deadbeef-dead-beef-dead-beefdeadbeef'

const mockGetAuthContext = vi.fn()
const mockGetProject = vi.fn()
const mockUpdateProject = vi.fn()
const mockUpdateProjectHealth = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({} as unknown),
}))

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
}))

vi.mock('@/lib/projects/queries', () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}))

vi.mock('@/lib/projects/mutations', () => ({
  updateProject: (...args: unknown[]) => mockUpdateProject(...args),
  updateProjectHealth: (...args: unknown[]) => mockUpdateProjectHealth(...args),
}))

import { PATCH } from '../../app/api/projects/[id]/route'

function buildRequest(body: unknown): Request {
  return new Request(`http://test.local/api/projects/${TEST_PROJECT_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const ctx = (id: string = TEST_PROJECT_ID) => ({ params: Promise.resolve({ id }) })

function authed() {
  mockGetAuthContext.mockResolvedValue({
    userId: TEST_USER_ID,
    orgId: TEST_ORG_ID,
    email: 'scott@example.com',
    role: 'owner',
    orgPlan: 'starter',
  })
}

function existingProject(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_PROJECT_ID,
    organization_id: TEST_ORG_ID,
    name: 'Demo',
    health: 'green',
    phase: 'Planning',
    owner_id: TEST_USER_ID,
    start_date: null,
    target_end_date: null,
    ...overrides,
  }
}

describe('PATCH /api/projects/[id]', () => {
  beforeEach(() => {
    mockGetAuthContext.mockReset()
    mockGetProject.mockReset()
    mockUpdateProject.mockReset()
    mockUpdateProjectHealth.mockReset()
  })

  it('health-only change: branches through updateProjectHealth and returns auditEntry', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject({ health: 'green' }))
    mockUpdateProjectHealth.mockResolvedValue({
      project: existingProject({ health: 'yellow' }),
      auditEntry: {
        id: 'audit-1',
        action: 'project.health_changed',
        actor_name: 'Scott Presley',
        old_value: { health: 'green' },
        new_value: { health: 'yellow' },
        created_at: '2026-04-19T12:00:00Z',
      },
    })

    const res = await PATCH(buildRequest({ health: 'yellow' }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.health).toBe('yellow')
    expect(body.auditEntry?.id).toBe('audit-1')

    expect(mockUpdateProjectHealth).toHaveBeenCalledWith(
      expect.anything(),
      TEST_PROJECT_ID,
      'yellow',
      TEST_USER_ID,
    )
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })

  it('non-health change: branches through updateProject and returns auditEntry: null', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject())
    mockUpdateProject.mockResolvedValue(existingProject({ phase: 'Execution' }))

    const res = await PATCH(buildRequest({ phase: 'Execution' }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.phase).toBe('Execution')
    expect(body.auditEntry).toBeNull()

    expect(mockUpdateProjectHealth).not.toHaveBeenCalled()
    expect(mockUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      TEST_PROJECT_ID,
      { phase: 'Execution' },
    )
  })

  it('mixed change: health + phase both call the right mutations, audit is from the health path', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject({ health: 'green' }))
    mockUpdateProjectHealth.mockResolvedValue({
      project: existingProject({ health: 'red' }),
      auditEntry: {
        id: 'audit-2',
        action: 'project.health_changed',
        actor_name: 'Scott',
        old_value: { health: 'green' },
        new_value: { health: 'red' },
        created_at: '2026-04-19T12:00:00Z',
      },
    })
    mockUpdateProject.mockResolvedValue(
      existingProject({ health: 'red', phase: 'Closing' }),
    )

    const res = await PATCH(
      buildRequest({ health: 'red', phase: 'Closing' }),
      ctx(),
    )
    expect(res.status).toBe(200)
    expect(mockUpdateProjectHealth).toHaveBeenCalled()
    expect(mockUpdateProject).toHaveBeenCalledWith(expect.anything(), TEST_PROJECT_ID, {
      phase: 'Closing',
    })
    const body = await res.json()
    expect(body.project.phase).toBe('Closing')
    expect(body.project.health).toBe('red')
    expect(body.auditEntry?.id).toBe('audit-2')
  })

  it('no-op health change (same value) skips updateProjectHealth', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject({ health: 'green' }))
    mockUpdateProject.mockResolvedValue(existingProject({ phase: 'x' }))

    const res = await PATCH(
      buildRequest({ health: 'green', phase: 'x' }),
      ctx(),
    )
    expect(res.status).toBe(200)
    expect(mockUpdateProjectHealth).not.toHaveBeenCalled()
    expect(mockUpdateProject).toHaveBeenCalledWith(expect.anything(), TEST_PROJECT_ID, {
      phase: 'x',
    })
  })

  it('owner_id: null is honored (explicit unassign)', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject({ owner_id: TEST_USER_ID }))
    mockUpdateProject.mockResolvedValue(existingProject({ owner_id: null }))

    const res = await PATCH(buildRequest({ owner_id: null }), ctx())
    expect(res.status).toBe(200)
    expect(mockUpdateProject).toHaveBeenCalledWith(expect.anything(), TEST_PROJECT_ID, {
      owner_id: null,
    })
  })

  it('empty string phase is normalized to null', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject())
    mockUpdateProject.mockResolvedValue(existingProject({ phase: null }))

    const res = await PATCH(buildRequest({ phase: '' }), ctx())
    expect(res.status).toBe(200)
    expect(mockUpdateProject).toHaveBeenCalledWith(expect.anything(), TEST_PROJECT_ID, {
      phase: null,
    })
  })

  it('rejects cross-date violation when both dates are in the patch', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject())

    const res = await PATCH(
      buildRequest({ start_date: '2026-05-01', target_end_date: '2026-04-15' }),
      ctx(),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.target_end_date).toMatch(/on or after/i)
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })

  it('rejects single-date edit that crosses an existing date (defense-in-depth)', async () => {
    authed()
    // Project already has target_end_date = 2026-04-15 (earlier than
    // the new start_date). The schema's refine wouldn't catch this
    // because only start_date is in the patch body — handler's
    // explicit merge check kicks in.
    mockGetProject.mockResolvedValue(
      existingProject({ start_date: '2026-04-01', target_end_date: '2026-04-15' }),
    )

    const res = await PATCH(buildRequest({ start_date: '2026-05-01' }), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fields?.target_end_date).toMatch(/on or after/i)
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetAuthContext.mockResolvedValue(null)
    const res = await PATCH(buildRequest({ health: 'yellow' }), ctx())
    expect(res.status).toBe(401)
    expect(mockGetProject).not.toHaveBeenCalled()
  })

  it('returns 404 when project not in caller org', async () => {
    authed()
    mockGetProject.mockResolvedValue(null)
    const res = await PATCH(buildRequest({ health: 'yellow' }), ctx())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('PROJECT_NOT_FOUND')
  })

  it('ignores organization_id + id from request body', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject())
    mockUpdateProject.mockResolvedValue(existingProject({ phase: 'x' }))

    const res = await PATCH(
      buildRequest({
        phase: 'x',
        organization_id: TEST_OTHER_ORG_ID,
        id: '99999999-9999-4999-8999-999999999999',
      }),
      ctx(),
    )
    expect(res.status).toBe(200)
    const [, , patch] = mockUpdateProject.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ]
    expect(patch).not.toHaveProperty('organization_id')
    expect(patch).not.toHaveProperty('id')
  })

  it('returns 400 on zod validation (invalid health enum)', async () => {
    authed()
    const res = await PATCH(buildRequest({ health: 'purple' }), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.health).toBeTruthy()
    expect(mockGetProject).not.toHaveBeenCalled()
  })

  it('returns 400 on malformed JSON', async () => {
    authed()
    const res = await PATCH(buildRequest('{ not json'), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 500 on unexpected mutation failure', async () => {
    authed()
    mockGetProject.mockResolvedValue(existingProject())
    mockUpdateProject.mockRejectedValue(new Error('pg exploded'))

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await PATCH(buildRequest({ phase: 'x' }), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(body.error).not.toMatch(/pg exploded/)
    consoleErr.mockRestore()
  })
})
