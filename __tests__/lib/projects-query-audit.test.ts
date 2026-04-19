// Tests for listProjectAuditLog — default filters, join shape,
// actor_name resolution.

import { describe, test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { listProjectAuditLog } from '@/lib/projects/queries'

type Client = SupabaseClient<Database>

// Thenable mock matching the pattern in __tests__/lib/projects.test.ts.
function makeQuery(terminal: { data: unknown; error: unknown }) {
  const self = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: terminal.data, error: terminal.error }),
  } as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    then: (r: (v: unknown) => void) => void
  }
  const chain = ['select', 'eq', 'in', 'order', 'limit'] as const
  for (const name of chain) self[name].mockImplementation(() => self)
  return self
}

function client(q: ReturnType<typeof makeQuery>): Client {
  return { from: vi.fn(() => q) } as unknown as Client
}

describe('listProjectAuditLog', () => {
  test('defaults: filter by project.health_changed, limit 5, newest first', async () => {
    const q = makeQuery({ data: [], error: null })
    await listProjectAuditLog(client(q), 'proj-1')

    expect(q.select).toHaveBeenCalledWith(
      'id, action, old_value, new_value, created_at, actor:users!audit_log_user_id_fkey(full_name, email)',
    )
    expect(q.eq).toHaveBeenCalledWith('entity_type', 'project')
    expect(q.eq).toHaveBeenCalledWith('entity_id', 'proj-1')
    expect(q.in).toHaveBeenCalledWith('action', ['project.health_changed'])
    expect(q.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(5)
  })

  test('honors explicit opts.limit and opts.actions', async () => {
    const q = makeQuery({ data: [], error: null })
    await listProjectAuditLog(client(q), 'proj-1', {
      limit: 20,
      actions: ['project.owner_changed', 'project.health_changed'],
    })

    expect(q.in).toHaveBeenCalledWith('action', [
      'project.owner_changed',
      'project.health_changed',
    ])
    expect(q.limit).toHaveBeenCalledWith(20)
  })

  test('maps actor via displayName fallback and shapes the ProjectAuditEntry', async () => {
    const q = makeQuery({
      data: [
        {
          id: 'a1',
          action: 'project.health_changed',
          old_value: { health: 'green' },
          new_value: { health: 'yellow' },
          created_at: '2026-04-19T12:00:00Z',
          actor: { full_name: 'Scott Presley', email: 'scott@example.com' },
        },
        {
          id: 'a2',
          action: 'project.health_changed',
          old_value: { health: 'yellow' },
          new_value: { health: 'red' },
          created_at: '2026-04-18T12:00:00Z',
          actor: { full_name: null, email: 'nameless@example.com' },
        },
        {
          id: 'a3',
          action: 'project.health_changed',
          old_value: null,
          new_value: null,
          created_at: '2026-04-17T12:00:00Z',
          actor: null,
        },
      ],
      error: null,
    })

    const rows = await listProjectAuditLog(client(q), 'proj-1')
    expect(rows).toHaveLength(3)
    expect(rows[0].actor_name).toBe('Scott Presley')
    expect(rows[1].actor_name).toBe('nameless')
    expect(rows[2].actor_name).toBeNull()
    expect(rows[0]).toEqual({
      id: 'a1',
      action: 'project.health_changed',
      actor_name: 'Scott Presley',
      old_value: { health: 'green' },
      new_value: { health: 'yellow' },
      created_at: '2026-04-19T12:00:00Z',
    })
  })

  test('returns [] when Supabase returns null data', async () => {
    const q = makeQuery({ data: null, error: null })
    const rows = await listProjectAuditLog(client(q), 'proj-1')
    expect(rows).toEqual([])
  })

  test('throws on DB error', async () => {
    const q = makeQuery({
      data: null,
      error: { message: 'pg exploded', code: 'X' },
    })
    await expect(listProjectAuditLog(client(q), 'proj-1')).rejects.toMatchObject({
      message: 'pg exploded',
    })
  })
})
