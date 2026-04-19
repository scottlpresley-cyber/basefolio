// Unit tests for POST /api/projects. Mocks the auth context, mutation
// helper, and plan-limit gate; asserts the route's contract
// (201/400/401/402/500) and the non-negotiable "organization_id is
// always from auth, never from the body" rule.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'
const TEST_OTHER_ORG_ID = 'deadbeef-dead-beef-dead-beefdeadbeef'

const mockGetAuthContext = vi.fn()
const mockEnforceProjectLimit = vi.fn()
const mockCreateProject = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({} as unknown),
}))

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
}))

vi.mock('@/lib/projects/mutations', () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args),
}))

// Keep the real PlanLimitError class so `err instanceof PlanLimitError`
// still works inside the route handler — only replace enforceProjectLimit.
vi.mock('@/lib/projects/plan-limits', async () => {
  const actual = await vi.importActual<typeof import('@/lib/projects/plan-limits')>(
    '@/lib/projects/plan-limits',
  )
  return {
    ...actual,
    enforceProjectLimit: (...args: unknown[]) => mockEnforceProjectLimit(...args),
  }
})

// Import AFTER mocks are registered.
import { POST } from '../../app/api/projects/route'
import { PlanLimitError } from '../../lib/projects/plan-limits'

function buildRequest(body: unknown): Request {
  return new Request('http://test.local/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
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

function unauthed() {
  mockGetAuthContext.mockResolvedValue(null)
}

describe('POST /api/projects', () => {
  beforeEach(() => {
    mockGetAuthContext.mockReset()
    mockEnforceProjectLimit.mockReset()
    mockCreateProject.mockReset()
    // Plan check is permissive by default; specific tests override.
    mockEnforceProjectLimit.mockResolvedValue(undefined)
  })

  it('returns 201 with id on happy path', async () => {
    authed()
    mockCreateProject.mockResolvedValue({ id: 'new-proj-1', name: 'Demo' })

    const res = await POST(buildRequest({ name: 'Demo', health: 'green' }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ id: 'new-proj-1' })

    // createProject received the full payload with orgId from auth.
    expect(mockCreateProject).toHaveBeenCalledOnce()
    const [, insertArg] = mockCreateProject.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(insertArg.organization_id).toBe(TEST_ORG_ID)
    expect(insertArg.name).toBe('Demo')
    expect(insertArg.health).toBe('green')
  })

  it('returns 401 when not authenticated', async () => {
    unauthed()

    const res = await POST(buildRequest({ name: 'Demo', health: 'green' }))

    expect(res.status).toBe(401)
    expect(mockCreateProject).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.code).toBe('UNAUTHENTICATED')
  })

  it('returns 400 with a field error when name is missing', async () => {
    authed()

    const res = await POST(buildRequest({ health: 'green' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.name).toBeTruthy()
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('returns 400 when target_end_date is before start_date', async () => {
    authed()

    const res = await POST(
      buildRequest({
        name: 'Demo',
        health: 'green',
        start_date: '2026-05-01',
        target_end_date: '2026-04-15',
      }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.target_end_date).toMatch(/on or after/i)
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('returns 402 with plan-limit details when enforceProjectLimit throws', async () => {
    authed()
    mockEnforceProjectLimit.mockRejectedValue(new PlanLimitError(15, 15, 'starter'))

    const res = await POST(buildRequest({ name: 'Demo', health: 'green' }))

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      limit: 15,
      current: 15,
      plan: 'starter',
    })
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('ignores organization_id from the body and uses auth.orgId', async () => {
    authed()
    mockCreateProject.mockResolvedValue({ id: 'new-proj-x' })

    const res = await POST(
      buildRequest({
        name: 'Smuggled',
        health: 'green',
        // A hostile client trying to plant a row under another org.
        organization_id: TEST_OTHER_ORG_ID,
      }),
    )

    expect(res.status).toBe(201)
    const [, insertArg] = mockCreateProject.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(insertArg.organization_id).toBe(TEST_ORG_ID)
    expect(insertArg.organization_id).not.toBe(TEST_OTHER_ORG_ID)
  })

  it('returns 400 on malformed JSON body', async () => {
    authed()

    const res = await POST(buildRequest('{ not json'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('returns 500 on unexpected createProject failure', async () => {
    authed()
    mockCreateProject.mockRejectedValue(new Error('pg exploded'))

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(buildRequest({ name: 'Demo', health: 'green' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL_ERROR')
    // Must not leak the underlying error message to the client.
    expect(body.error).not.toMatch(/pg exploded/)
    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })
})
