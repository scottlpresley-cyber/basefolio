// Unit tests for POST /api/projects/[id]/updates/assist. Mocks the
// auth context, project lookup, Claude call, rate-limit functions,
// and the usage log. Asserts the contract (200/400/401/404/429/502/
// 500) and the "log on success only" rule.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'
const TEST_PROJECT_ID = '33333333-3333-4333-8333-333333333333'

const mockGetAuthContext = vi.fn()
const mockEnforceRateLimit = vi.fn()
const mockLogAIUsageEvent = vi.fn()
const mockGetProject = vi.fn()
const mockListProjectUpdates = vi.fn()
const mockCallClaude = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({} as unknown),
}))

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
}))

vi.mock('@/lib/projects/queries', () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
  listProjectUpdates: (...args: unknown[]) => mockListProjectUpdates(...args),
}))

vi.mock('@/lib/ai/claude', () => ({
  callClaude: (...args: unknown[]) => mockCallClaude(...args),
}))

// Keep the real RateLimitExceededError class so the route handler's
// `instanceof` check works. Replace enforceRateLimit and
// logAIUsageEvent with mocks.
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>(
    '@/lib/rate-limit',
  )
  return {
    ...actual,
    enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
    logAIUsageEvent: (...args: unknown[]) => mockLogAIUsageEvent(...args),
  }
})

// Import route AFTER all mocks register.
import { POST } from '../../app/api/projects/[id]/updates/assist/route'
import { RateLimitExceededError } from '../../lib/rate-limit'

function buildRequest(body: unknown): Request {
  return new Request(
    `http://test.local/api/projects/${TEST_PROJECT_ID}/updates/assist`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  )
}

const ctx = (id: string = TEST_PROJECT_ID) => ({
  params: Promise.resolve({ id }),
})

function authed() {
  mockGetAuthContext.mockResolvedValue({
    userId: TEST_USER_ID,
    orgId: TEST_ORG_ID,
    email: 'scott@example.com',
    role: 'owner',
    orgPlan: 'starter',
  })
}

function validJsonDraft(override: Record<string, unknown> = {}) {
  return JSON.stringify({
    summary: 'Payments integration landed; no new blockers.',
    accomplishments: 'Shipped refund path.',
    next_steps: null,
    blockers: null,
    suggested_health: 'green',
    ...override,
  })
}

function mockClaudeText(text: string) {
  mockCallClaude.mockResolvedValue({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 420, output_tokens: 80 },
  })
}

const SAMPLE_NOTES =
  'shipped the refund path; three long-standing bugs closed this week'

describe('POST /api/projects/[id]/updates/assist', () => {
  beforeEach(() => {
    mockGetAuthContext.mockReset()
    mockEnforceRateLimit.mockReset()
    mockLogAIUsageEvent.mockReset()
    mockGetProject.mockReset()
    mockListProjectUpdates.mockReset()
    mockCallClaude.mockReset()
    mockEnforceRateLimit.mockResolvedValue(undefined)
    mockListProjectUpdates.mockResolvedValue([])
  })

  it('returns 200 with the parsed draft on happy path', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
      name: 'Payments rebuild',
    })
    mockClaudeText(validJsonDraft())

    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      summary: expect.stringContaining('Payments'),
      accomplishments: expect.stringContaining('refund'),
      next_steps: null,
      blockers: null,
      suggested_health: 'green',
    })
  })

  it('returns 400 when notes is empty', async () => {
    authed()
    const res = await POST(buildRequest({ notes: '' }), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.notes).toBeTruthy()
    expect(mockCallClaude).not.toHaveBeenCalled()
  })

  it('returns 400 when notes exceeds 10000 characters', async () => {
    authed()
    const longNotes = 'x'.repeat(10001)
    const res = await POST(buildRequest({ notes: longNotes }), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields?.notes).toMatch(/10,?000/)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetAuthContext.mockResolvedValue(null)
    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(401)
    expect(mockCallClaude).not.toHaveBeenCalled()
  })

  it('returns 404 PROJECT_NOT_FOUND when getProject returns null', async () => {
    authed()
    mockGetProject.mockResolvedValue(null)
    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('PROJECT_NOT_FOUND')
    expect(mockCallClaude).not.toHaveBeenCalled()
  })

  it('returns 429 with retry_after_seconds when rate limit triggers', async () => {
    authed()
    mockEnforceRateLimit.mockRejectedValue(
      new RateLimitExceededError(20, 1234),
    )

    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body).toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      retry_after_seconds: 1234,
    })
    expect(res.headers.get('Retry-After')).toBe('1234')
    expect(mockCallClaude).not.toHaveBeenCalled()
    expect(mockLogAIUsageEvent).not.toHaveBeenCalled()
  })

  it('returns 502 AI_OUTPUT_PARSE_FAILED when Claude returns unparseable text', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
      name: 'X',
    })
    mockClaudeText("Well, I'd love to help but the notes are complicated.")

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('AI_OUTPUT_PARSE_FAILED')
    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })

  it('returns 502 when Claude returns JSON with hallucinated fields', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
      name: 'X',
    })
    mockClaudeText(
      JSON.stringify({
        summary: 's',
        accomplishments: null,
        next_steps: null,
        blockers: null,
        suggested_health: 'green',
        confidence: 0.9, // hallucinated
      }),
    )

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(502)
    consoleErr.mockRestore()
  })

  it('logs an ai_usage_events row AFTER a successful draft', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
      name: 'X',
    })
    mockClaudeText(validJsonDraft())

    await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())

    expect(mockLogAIUsageEvent).toHaveBeenCalledOnce()
    const [, userId, orgId, event] = mockLogAIUsageEvent.mock.calls[0] as [
      unknown,
      string,
      string,
      Record<string, unknown>,
    ]
    expect(userId).toBe(TEST_USER_ID)
    expect(orgId).toBe(TEST_ORG_ID)
    expect(event).toMatchObject({
      event_type: 'status_assist',
      model: 'classify',
      tokens_in: 420,
      tokens_out: 80,
    })
  })

  it('does NOT log to ai_usage_events when Claude output fails to parse', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
      name: 'X',
    })
    mockClaudeText('garbled')

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(502)
    expect(mockLogAIUsageEvent).not.toHaveBeenCalled()
    consoleErr.mockRestore()
  })

  it('returns 500 on unexpected Claude SDK failure', async () => {
    authed()
    mockGetProject.mockResolvedValue({
      id: TEST_PROJECT_ID,
      organization_id: TEST_ORG_ID,
      name: 'X',
    })
    mockCallClaude.mockRejectedValue(new Error('Anthropic API blew up'))

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(buildRequest({ notes: SAMPLE_NOTES }), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(body.error).not.toMatch(/Anthropic/)
    expect(mockLogAIUsageEvent).not.toHaveBeenCalled()
    consoleErr.mockRestore()
  })

  it('returns 400 on malformed JSON body', async () => {
    authed()
    const res = await POST(buildRequest('{ not json'), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
    expect(mockCallClaude).not.toHaveBeenCalled()
  })
})
