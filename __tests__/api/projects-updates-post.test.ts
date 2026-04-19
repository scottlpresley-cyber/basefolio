// Unit tests for POST /api/projects/[id]/updates. Mocks auth context,
// the project lookup, and the create mutation; asserts the route's
// contract (201/400/401/404/500) and the "org/project/author come
// from server-side context, never from request body" rule.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'
const TEST_PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const TEST_OTHER_ORG_ID = 'deadbeef-dead-beef-dead-beefdeadbeef'
const TEST_OTHER_PROJECT_ID = 'cafef00d-cafe-f00d-cafe-f00dcafef00d'

const mockGetAuthContext = vi.fn()
const mockGetProject = vi.fn()
const mockCreateProjectUpdate = vi.fn()

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
  createProjectUpdate: (...args: unknown[]) => mockCreateProjectUpdate(...args),
}))

import { POST } from '../../app/api/projects/[id]/updates/route'

function buildRequest(body: unknown): Request {
  return new Request(`http://test.local/api/projects/${TEST_PROJECT_ID}/updates`, {
    method: 'POST',
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

describe('POST /api/projects/[id]/updates', () => {
  beforeEach(() => {
    mockGetAuthContext.mockReset()
    mockGetProject.mockReset()
    mockCreateProjectUpdate.mockReset()
  })

  it('returns 201 with the full row on happy path', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
    })
    mockCreateProjectUpdate.mockResolvedValue({
      id: 'u-new',
      project_id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
      author_id: TEST_USER_ID,
      health: 'green',
      summary: 'All good.',
      author_name: 'Scott Presley',
    })

    const res = await POST(
      buildRequest({ health: 'green', summary: 'All good.' }),
      ctx(),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('u-new')
    expect(body.author_name).toBe('Scott Presley')

    const [, insertArg] = mockCreateProjectUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ]
    expect(insertArg.organization_id).toBe(TEST_ORG_ID)
    expect(insertArg.project_id).toBe(TEST_PROJECT_ID)
    expect(insertArg.author_id).toBe(TEST_USER_ID)
    // Period fields explicitly nulled even when caller doesn't send them.
    expect(insertArg.period_start).toBeNull()
    expect(insertArg.period_end).toBeNull()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetAuthContext.mockResolvedValue(null)

    const res = await POST(buildRequest({ health: 'green', summary: 's' }), ctx())

    expect(res.status).toBe(401)
    expect(mockGetProject).not.toHaveBeenCalled()
    expect(mockCreateProjectUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when summary is missing', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
    })

    const res = await POST(buildRequest({ health: 'green' }), ctx())

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.summary).toBeTruthy()
    expect(mockCreateProjectUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when summary exceeds 4000 chars', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
    })

    const tooLong = 'x'.repeat(4001)
    const res = await POST(
      buildRequest({ health: 'green', summary: tooLong }),
      ctx(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fields?.summary).toMatch(/4000/)
  })

  it('returns 404 when the project is not in the caller org (RLS-hidden)', async () => {
    authed()
    // getProject returns null both for "doesn't exist" and "exists in
    // another org" — the route collapses both to 404 to avoid leaking
    // existence across tenants.
    mockGetProject.mockResolvedValue(null)

    const res = await POST(
      buildRequest({ health: 'green', summary: 's' }),
      ctx(TEST_OTHER_PROJECT_ID),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('PROJECT_NOT_FOUND')
    expect(mockCreateProjectUpdate).not.toHaveBeenCalled()
  })

  it('ignores hostile organization_id / project_id / author_id from body', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
    })
    mockCreateProjectUpdate.mockResolvedValue({ id: 'u-x' })

    const res = await POST(
      buildRequest({
        health: 'green',
        summary: 's',
        // Hostile fields the schema doesn't define — zod strips them
        // implicitly, and the route's explicit field-by-field
        // construction is the second line of defense.
        organization_id: TEST_OTHER_ORG_ID,
        project_id: TEST_OTHER_PROJECT_ID,
        author_id: '99999999-9999-4999-8999-999999999999',
      }),
      ctx(),
    )

    expect(res.status).toBe(201)
    const [, insertArg] = mockCreateProjectUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ]
    expect(insertArg.organization_id).toBe(TEST_ORG_ID)
    expect(insertArg.project_id).toBe(TEST_PROJECT_ID)
    expect(insertArg.author_id).toBe(TEST_USER_ID)
  })

  it('returns 400 on malformed JSON', async () => {
    authed()
    const res = await POST(buildRequest('{ not json'), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 500 on unexpected createProjectUpdate failure', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
    })
    mockCreateProjectUpdate.mockRejectedValue(new Error('pg exploded'))

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(buildRequest({ health: 'green', summary: 's' }), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(body.error).not.toMatch(/pg exploded/)
    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })
})
