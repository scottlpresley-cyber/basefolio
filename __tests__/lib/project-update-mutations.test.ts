// Unit tests for createProjectUpdate (status update insert mutation).
// Mirrors the test pattern in __tests__/lib/projects.test.ts —
// hand-rolled mock client, asserts query shape and the author_name
// resolution.

import { describe, test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { createProjectUpdate } from '@/lib/projects/mutations'

type Client = SupabaseClient<Database>

function makeInsertChain(terminal: { data: unknown; error: unknown }) {
  const self = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(() =>
      Promise.resolve({ data: terminal.data, error: terminal.error }),
    ),
  } as {
    insert: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
  }
  self.insert.mockImplementation(() => self)
  self.select.mockImplementation(() => self)
  return self
}

describe('createProjectUpdate', () => {
  test('inserts the row + selects with author join + resolves author_name', async () => {
    const chain = makeInsertChain({
      data: {
        id: 'u-new',
        project_id: 'p1',
        organization_id: 'org-1',
        author_id: 'user-1',
        health: 'yellow',
        summary: 'Heads up',
        author: { full_name: 'Scott Presley', email: 'scott@example.com' },
      },
      error: null,
    })
    const client = { from: vi.fn(() => chain) } as unknown as Client

    const created = await createProjectUpdate(client, {
      organization_id: 'org-1',
      project_id: 'p1',
      author_id: 'user-1',
      health: 'yellow',
      summary: 'Heads up',
      accomplishments: null,
      next_steps: null,
      blockers: null,
      period_start: null,
      period_end: null,
    })

    expect(client.from).toHaveBeenCalledWith('project_updates')
    expect(chain.insert).toHaveBeenCalledOnce()
    expect(chain.select).toHaveBeenCalledWith(
      '*, author:users!project_updates_author_id_fkey(full_name, email)',
    )
    expect(created).toEqual({
      id: 'u-new',
      project_id: 'p1',
      organization_id: 'org-1',
      author_id: 'user-1',
      health: 'yellow',
      summary: 'Heads up',
      author_name: 'Scott Presley',
    })
  })

  test('falls back to email local-part for author_name when full_name is null', async () => {
    const chain = makeInsertChain({
      data: {
        id: 'u-new',
        author: { full_name: null, email: 'scott.l.presley@gmail.com' },
      },
      error: null,
    })
    const client = { from: vi.fn(() => chain) } as unknown as Client

    const created = await createProjectUpdate(client, {
      organization_id: 'org-1',
      project_id: 'p1',
      author_id: 'user-1',
      health: 'green',
      summary: 's',
    })

    expect(created.author_name).toBe('scott.l.presley')
  })

  test('returns author_name: null when author row is missing', async () => {
    const chain = makeInsertChain({
      data: { id: 'u-new', author: null },
      error: null,
    })
    const client = { from: vi.fn(() => chain) } as unknown as Client

    const created = await createProjectUpdate(client, {
      organization_id: 'org-1',
      project_id: 'p1',
      author_id: 'user-1',
      health: 'green',
      summary: 's',
    })

    expect(created.author_name).toBeNull()
  })

  test('throws on DB error', async () => {
    const chain = makeInsertChain({
      data: null,
      error: { message: 'pg exploded', code: 'X' },
    })
    const client = { from: vi.fn(() => chain) } as unknown as Client

    await expect(
      createProjectUpdate(client, {
        organization_id: 'org-1',
        project_id: 'p1',
        author_id: 'user-1',
        health: 'green',
        summary: 's',
      }),
    ).rejects.toMatchObject({ message: 'pg exploded' })
  })
})
