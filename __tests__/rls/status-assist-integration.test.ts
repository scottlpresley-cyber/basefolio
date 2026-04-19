// End-to-end integration for POST /api/projects/[id]/updates/assist.
// Drives the full route against the live DB — auth context, project
// ownership, rate-limit reads, and the ai_usage_events write all
// talk to real Supabase. Claude is mocked (stubbing a real Haiku
// call per test would cost money and add flake).

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
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

const mockCallClaude = vi.fn()
vi.mock('@/lib/ai/claude', () => ({
  callClaude: (...args: unknown[]) => mockCallClaude(...args),
}))

import { POST } from '../../app/api/projects/[id]/updates/assist/route'
import { createProject } from '@/lib/projects/mutations'

const missing = missingEnv()
if (missing.length) {
  console.warn(`[rls/assist] Skipping — missing env: ${missing.join(', ')}`)
}

function buildRequest(projectId: string, notes: string): Request {
  return new Request(
    `http://test.local/api/projects/${projectId}/updates/assist`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes }),
    },
  )
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function mockClaudeDraft(override: Record<string, unknown> = {}) {
  mockCallClaude.mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          summary: 'Steady progress; no new risks.',
          accomplishments: null,
          next_steps: null,
          blockers: null,
          suggested_health: 'green',
          ...override,
        }),
      },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  })
}

async function clearUsage(userId: string) {
  const svc = serviceClient()
  await svc
    .from('ai_usage_events')
    .delete()
    .eq('user_id', userId)
    .eq('event_type', 'status_assist')
}

describe.skipIf(missing.length > 0)(
  'POST /api/projects/[id]/updates/assist (live RLS)',
  () => {
    let orgA: TestOrg
    let orgB: TestOrg

    beforeAll(async () => {
      await preCleanup()
      orgA = await createTestOrg('assist-a')
      orgB = await createTestOrg('assist-b')
    }, 60_000)

    afterAll(async () => {
      currentClient = null
      const orgIds = [orgA?.orgId, orgB?.orgId].filter(Boolean) as string[]
      const userIds = [orgA?.userId, orgB?.userId].filter(Boolean) as string[]
      await cleanupOrgs(orgIds, userIds)
    }, 60_000)

    beforeEach(async () => {
      currentClient = null
      mockCallClaude.mockReset()
      await clearUsage(orgA.userId)
      await clearUsage(orgB.userId)
    })

    test('happy path: returns the parsed draft and logs a usage row', async () => {
      const proj = await createProject(orgA.userClient, {
        organization_id: orgA.orgId,
        name: 'rls-assist-happy',
        owner_id: orgA.userId,
      })
      mockClaudeDraft()

      currentClient = orgA.userClient
      const res = await POST(
        buildRequest(proj.id, 'shipped the refund path this week'),
        ctx(proj.id),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.suggested_health).toBe('green')
      expect(body.summary).toContain('Steady progress')

      // Confirm the assist usage row landed via service role.
      const svc = serviceClient()
      const { data } = await svc
        .from('ai_usage_events')
        .select('event_type, model, tokens_in, tokens_out')
        .eq('user_id', orgA.userId)
        .eq('event_type', 'status_assist')
      expect(data).toHaveLength(1)
      expect(data?.[0]).toMatchObject({
        event_type: 'status_assist',
        model: 'classify',
        tokens_in: 100,
        tokens_out: 50,
      })
    })

    test('cross-tenant: user B cannot assist on user A\'s project (404)', async () => {
      const proj = await createProject(orgA.userClient, {
        organization_id: orgA.orgId,
        name: 'rls-assist-cross',
        owner_id: orgA.userId,
      })
      mockClaudeDraft()

      currentClient = orgB.userClient
      const res = await POST(buildRequest(proj.id, 'n'), ctx(proj.id))
      expect(res.status).toBe(404)
      expect(mockCallClaude).not.toHaveBeenCalled()

      // And no usage row under B.
      const svc = serviceClient()
      const { count } = await svc
        .from('ai_usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', orgB.userId)
        .eq('event_type', 'status_assist')
      expect(count ?? 0).toBe(0)
    })

    test('rate limit: 20 in-window events trip the gate on the 21st call', async () => {
      const proj = await createProject(orgA.userClient, {
        organization_id: orgA.orgId,
        name: 'rls-assist-rate',
        owner_id: orgA.userId,
      })

      // Seed 20 recent events via service role — below the cap is
      // fine, the cap fires at count >= 20 (see lib/rate-limit).
      const svc = serviceClient()
      const now = Date.now()
      const seed = Array.from({ length: 20 }, (_, i) => ({
        organization_id: orgA.orgId,
        user_id: orgA.userId,
        event_type: 'status_assist' as const,
        model: 'classify' as const,
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
        created_at: new Date(now - (1800 - i * 30) * 1000).toISOString(),
      }))
      const { error: seedErr } = await svc.from('ai_usage_events').insert(seed)
      expect(seedErr).toBeNull()

      mockClaudeDraft()
      currentClient = orgA.userClient
      const res = await POST(buildRequest(proj.id, 'notes'), ctx(proj.id))
      expect(res.status).toBe(429)
      const body = await res.json()
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(body.retry_after_seconds).toBeGreaterThan(0)
      expect(mockCallClaude).not.toHaveBeenCalled()
    }, 30_000)
  },
)
