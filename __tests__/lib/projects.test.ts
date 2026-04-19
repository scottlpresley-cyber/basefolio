// Unit tests for the projects data access layer. All tests use
// hand-rolled mock clients so they exercise the helpers' query shape
// without touching the DB. The RLS integration suite under
// __tests__/rls covers end-to-end behavior against real policies.

import { describe, test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ProjectPatch } from '@/types/app.types'
import {
  listProjects,
  getProject,
  getProjectsBySourceReport,
  countActiveProjects,
} from '@/lib/projects/queries'
import { updateProjectHealth } from '@/lib/projects/mutations'
import { enforceProjectLimit, PlanLimitError } from '@/lib/projects/plan-limits'

type Client = SupabaseClient<Database>

// Build a single-table mock whose terminal methods (resolve with a
// `then` or call `.single()` / `.maybeSingle()`) all return `terminal`.
// Each intermediate method is a spy returning `self` so callers can
// assert on the chain.
type Query = {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (resolve: (v: unknown) => void) => void
}

function makeQuery(terminal: { data: unknown; error: unknown; count?: number }): Query {
  const self = {} as Query
  const chainable = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'order', 'limit'] as const
  for (const name of chainable) {
    self[name] = vi.fn(() => self)
  }
  self.single = vi.fn(() => Promise.resolve({ data: terminal.data, error: terminal.error }))
  self.maybeSingle = vi.fn(() => Promise.resolve({ data: terminal.data, error: terminal.error }))
  // Thenable — supports `await query` at any point in the chain, for
  // list / count helpers that don't call a terminal method.
  self.then = (resolve) =>
    resolve({ data: terminal.data, error: terminal.error, count: terminal.count })
  return self
}

function makeClient(queries: Record<string, Query>): Client {
  return {
    from: vi.fn((table: string) => {
      const q = queries[table]
      if (!q) throw new Error(`unexpected from('${table}')`)
      return q
    }),
  } as unknown as Client
}

describe('listProjects', () => {
  test('defaults to status=active, ordered by created_at desc, and joins owner', async () => {
    const q = makeQuery({
      data: [{ id: 'p1', owner: { full_name: 'Scott Presley' } }],
      error: null,
    })
    const client = makeClient({ projects: q })

    const rows = await listProjects(client)

    // Join shape must land in the select — single round-trip for name + row.
    expect(q.select).toHaveBeenCalledWith(
      '*, owner:users!projects_owner_id_fkey(full_name)',
    )
    expect(q.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(q.eq).toHaveBeenCalledWith('status', 'active')
    expect(rows).toEqual([{ id: 'p1', owner_name: 'Scott Presley' }])
  })

  test('honors explicit status override', async () => {
    const q = makeQuery({ data: [], error: null })
    const client = makeClient({ projects: q })

    await listProjects(client, { status: 'completed' })

    expect(q.eq).toHaveBeenCalledWith('status', 'completed')
  })

  test('opts.status === undefined disables the filter', async () => {
    const q = makeQuery({ data: [], error: null })
    const client = makeClient({ projects: q })

    await listProjects(client, { status: undefined })

    // No .eq() for status should have been issued.
    expect(q.eq).not.toHaveBeenCalled()
  })

  test('returns empty array when Supabase returns null data', async () => {
    const q = makeQuery({ data: null, error: null })
    const client = makeClient({ projects: q })

    const rows = await listProjects(client)
    expect(rows).toEqual([])
  })

  test('maps missing / unreadable owner to owner_name: null', async () => {
    const q = makeQuery({
      data: [
        { id: 'p1', name: 'a', owner: null }, // owner_id null or unreadable
        { id: 'p2', name: 'b', owner: { full_name: null } }, // user row has no name
        { id: 'p3', name: 'c', owner: { full_name: 'Nomi' } },
      ],
      error: null,
    })
    const client = makeClient({ projects: q })

    const rows = await listProjects(client)
    expect(rows).toEqual([
      { id: 'p1', name: 'a', owner_name: null },
      { id: 'p2', name: 'b', owner_name: null },
      { id: 'p3', name: 'c', owner_name: 'Nomi' },
    ])
  })

  test('throws on DB error', async () => {
    const q = makeQuery({ data: null, error: { message: 'boom', code: 'X' } })
    const client = makeClient({ projects: q })
    await expect(listProjects(client)).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('getProject', () => {
  test('returns null when no row is found', async () => {
    const q = makeQuery({ data: null, error: null })
    const client = makeClient({ projects: q })

    const got = await getProject(client, 'missing-id')

    expect(q.eq).toHaveBeenCalledWith('id', 'missing-id')
    expect(q.maybeSingle).toHaveBeenCalledOnce()
    expect(got).toBeNull()
  })

  test('returns the row when present', async () => {
    const row = { id: 'p1', name: 'x' }
    const q = makeQuery({ data: row, error: null })
    const client = makeClient({ projects: q })

    const got = await getProject(client, 'p1')
    expect(got).toBe(row)
  })
})

describe('getProjectsBySourceReport', () => {
  test('filters by source_report_id and orders by created_at desc', async () => {
    const q = makeQuery({ data: [{ id: 'p1' }], error: null })
    const client = makeClient({ projects: q })

    const rows = await getProjectsBySourceReport(client, 'report-1')

    expect(q.eq).toHaveBeenCalledWith('source_report_id', 'report-1')
    expect(q.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(rows).toEqual([{ id: 'p1' }])
  })
})

describe('countActiveProjects', () => {
  test('uses head:true + count:exact and filters to active', async () => {
    const q = makeQuery({ data: null, error: null, count: 7 })
    const client = makeClient({ projects: q })

    const n = await countActiveProjects(client)

    expect(q.select).toHaveBeenCalledWith('*', { count: 'exact', head: true })
    expect(q.eq).toHaveBeenCalledWith('status', 'active')
    expect(n).toBe(7)
  })
})

describe('updateProjectHealth', () => {
  test('reads current health, updates, and inserts an audit row', async () => {
    // Three sequential from() calls: read, update, audit insert.
    const readQ = makeQuery({
      data: { health: 'green', organization_id: 'org-1' },
      error: null,
    })
    const updateQ = makeQuery({
      data: { id: 'proj-1', health: 'red', organization_id: 'org-1', name: 'demo' },
      error: null,
    })
    const auditQ = makeQuery({ data: { id: 'audit-1' }, error: null })

    const from = vi
      .fn()
      .mockReturnValueOnce(readQ)
      .mockReturnValueOnce(updateQ)
      .mockReturnValueOnce(auditQ)

    const client = { from } as unknown as Client

    const result = await updateProjectHealth(client, 'proj-1', 'red', 'user-1')

    // First from: projects read
    expect(from).toHaveBeenNthCalledWith(1, 'projects')
    expect(readQ.select).toHaveBeenCalledWith('health, organization_id')
    expect(readQ.eq).toHaveBeenCalledWith('id', 'proj-1')

    // Second from: projects update
    expect(from).toHaveBeenNthCalledWith(2, 'projects')
    expect(updateQ.update).toHaveBeenCalledWith({ health: 'red' })
    expect(updateQ.eq).toHaveBeenCalledWith('id', 'proj-1')

    // Third from: audit_log insert — verify full payload shape
    expect(from).toHaveBeenNthCalledWith(3, 'audit_log')
    expect(auditQ.insert).toHaveBeenCalledWith({
      organization_id: 'org-1',
      user_id: 'user-1',
      action: 'project.health_changed',
      entity_type: 'project',
      entity_id: 'proj-1',
      old_value: { health: 'green' },
      new_value: { health: 'red' },
    })

    expect(result).toEqual({
      project: { id: 'proj-1', health: 'red', organization_id: 'org-1', name: 'demo' },
      auditLogId: 'audit-1',
    })
  })

  test('throws when audit_log insert fails after successful update', async () => {
    const readQ = makeQuery({
      data: { health: 'green', organization_id: 'org-1' },
      error: null,
    })
    const updateQ = makeQuery({
      data: { id: 'proj-1', health: 'red' },
      error: null,
    })
    const auditQ = makeQuery({
      data: null,
      error: { message: 'audit insert blew up', code: 'X' },
    })

    const from = vi
      .fn()
      .mockReturnValueOnce(readQ)
      .mockReturnValueOnce(updateQ)
      .mockReturnValueOnce(auditQ)

    const client = { from } as unknown as Client

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      updateProjectHealth(client, 'proj-1', 'red', 'user-1'),
    ).rejects.toMatchObject({ message: 'audit insert blew up' })
    expect(consoleErr).toHaveBeenCalledOnce()
    consoleErr.mockRestore()
  })
})

describe('enforceProjectLimit', () => {
  test('throws PlanLimitError when current >= limit on starter', async () => {
    const q = makeQuery({ data: null, error: null, count: 15 })
    const client = makeClient({ projects: q })

    await expect(enforceProjectLimit(client, 'starter')).rejects.toBeInstanceOf(PlanLimitError)
    await expect(enforceProjectLimit(client, 'starter')).rejects.toMatchObject({
      limit: 15,
      current: 15,
      plan: 'starter',
    })
  })

  test('returns cleanly when under limit', async () => {
    const q = makeQuery({ data: null, error: null, count: 14 })
    const client = makeClient({ projects: q })
    await expect(enforceProjectLimit(client, 'starter')).resolves.toBeUndefined()
  })

  test('short-circuits without hitting DB for Infinity plans', async () => {
    const q = makeQuery({ data: null, error: null, count: 0 })
    const from = vi.fn().mockReturnValue(q)
    const client = { from } as unknown as Client

    await enforceProjectLimit(client, 'business')
    expect(from).not.toHaveBeenCalled()
  })
})

describe('ProjectPatch type', () => {
  test('rejects organization_id at compile time', () => {
    const patch: ProjectPatch = {
      name: 'renamed',
      // @ts-expect-error organization_id must not be assignable to ProjectPatch.
      organization_id: '00000000-0000-0000-0000-000000000000',
    }
    // Runtime assertion is a no-op; the real test is the ts-expect-error
    // above — if the field were ever added to ProjectPatch, tsc would
    // fail this test file with TS2578 ("Unused @ts-expect-error").
    expect(patch.name).toBe('renamed')
  })

  test('rejects id at compile time', () => {
    const patch: ProjectPatch = {
      name: 'renamed',
      // @ts-expect-error id must not be assignable to ProjectPatch.
      id: '00000000-0000-0000-0000-000000000000',
    }
    expect(patch.name).toBe('renamed')
  })
})
