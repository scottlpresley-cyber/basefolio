// Unit tests for bulkImportProjects + the resolveOwnerIdFromSignal
// helper it uses. Mocked supabase client; fixture-driven ImportPayload
// objects.

import { describe, test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { ImportPayload } from '@/lib/file-processing/build-project-payload'
import type { OrgMember } from '@/lib/users/queries'
import {
  bulkImportProjects,
  resolveOwnerIdFromSignal,
} from '@/lib/projects/mutations'

type Client = SupabaseClient<Database>

function payload(
  name: string,
  ownerSignal: string | null = null,
  overrides: Partial<ImportPayload['project']> = {},
): ImportPayload {
  return {
    project: {
      name,
      description: `${name} description`,
      phase: 'Execution',
      health: 'green',
      status: 'active',
      source: 'ado',
      external_id: name,
      target_end_date: null,
      inferredOwnerSignal: ownerSignal,
      ...overrides,
    },
    initialUpdate: {
      health: 'green',
      summary: `Imported. ${name}.`,
    },
  }
}

// Mock shape for a table router — each call to client.from(table)
// returns a chain configured for that table's expected ops.
type TableSpec = {
  existingExternalIds?: string[]
  existingError?: unknown
  insertedIds?: string[]
  insertError?: unknown
  capturedInsert?: { rows?: Record<string, unknown>[] }
  updatesInsertError?: unknown
  capturedUpdates?: { rows?: Record<string, unknown>[] }
}

function makeClient(spec: TableSpec): Client {
  const projectsChain = {
    select: vi.fn(),
    insert: vi.fn(),
    eq: vi.fn(),
  } as {
    select: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
  }

  // READ path: .select('external_id').eq(org, X).eq(report, Y)
  projectsChain.select.mockImplementation(() => {
    const readChain = {
      eq: vi.fn(),
    } as { eq: ReturnType<typeof vi.fn> }
    readChain.eq.mockImplementation(() => {
      const outer = {
        eq: async () =>
          spec.existingError
            ? { data: null, error: spec.existingError }
            : {
                data: (spec.existingExternalIds ?? []).map((id) => ({
                  external_id: id,
                })),
                error: null,
              },
      }
      return outer
    })
    return readChain
  })

  // WRITE path: .insert(rows).select('id')
  projectsChain.insert.mockImplementation((rows: Record<string, unknown>[]) => {
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
  })

  const updatesChain = {
    insert: vi.fn((rows: Record<string, unknown>[]) => {
      if (spec.capturedUpdates) spec.capturedUpdates.rows = rows
      return Promise.resolve({
        data: null,
        error: spec.updatesInsertError ?? null,
      })
    }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'projects') return projectsChain
      if (table === 'project_updates') return updatesChain
      throw new Error(`unexpected from('${table}')`)
    }),
  } as unknown as Client
}

const members: OrgMember[] = [
  { id: 'user-scott', full_name: 'Scott Presley', email: 'scott@example.com' },
  { id: 'user-emily', full_name: 'Emily Parker', email: 'emily@example.com' },
  { id: 'user-no-name', full_name: null, email: 'nameless@example.com' },
]

describe('resolveOwnerIdFromSignal', () => {
  test('matches by email first', () => {
    expect(resolveOwnerIdFromSignal('scott@example.com', members)).toBe('user-scott')
  })

  test('extracts email from "Display Name <email>" shape', () => {
    expect(
      resolveOwnerIdFromSignal('Scott Presley <scott@example.com>', members),
    ).toBe('user-scott')
  })

  test('falls back to exact case-insensitive full_name match', () => {
    expect(resolveOwnerIdFromSignal('emily parker', members)).toBe('user-emily')
  })

  test('email match beats name match when both could apply', () => {
    // A member with a matching email wins even if another member's name
    // happens to match the signal text.
    const overlap: OrgMember[] = [
      { id: 'win', full_name: null, email: 'foo@example.com' },
      { id: 'lose', full_name: 'foo@example.com', email: 'other@example.com' },
    ]
    expect(resolveOwnerIdFromSignal('foo@example.com', overlap)).toBe('win')
  })

  test('null signal -> null', () => {
    expect(resolveOwnerIdFromSignal(null, members)).toBeNull()
  })

  test('empty string signal -> null', () => {
    expect(resolveOwnerIdFromSignal('', members)).toBeNull()
  })

  test('no match -> null (never creates / guesses)', () => {
    expect(resolveOwnerIdFromSignal('unknown.person@elsewhere.com', members)).toBeNull()
  })

  test('partial name match -> null (no fuzzy matching)', () => {
    // Intentional: "Emily" shouldn't match "Emily Parker" — that
    // would introduce false positives where two Emilys exist.
    expect(resolveOwnerIdFromSignal('Emily', members)).toBeNull()
  })

  test('null full_name on a member is not matchable by name', () => {
    expect(resolveOwnerIdFromSignal('', members)).toBeNull()
  })
})

describe('bulkImportProjects', () => {
  const baseOpts = {
    organizationId: 'org-1',
    sourceReportId: 'report-1',
    userId: 'user-scott',
    orgMembers: members,
  }

  test('happy path: inserts every payload, resolves owners, seeds updates', async () => {
    const capturedInsert: { rows?: Record<string, unknown>[] } = {}
    const capturedUpdates: { rows?: Record<string, unknown>[] } = {}
    const client = makeClient({
      existingExternalIds: [],
      insertedIds: ['proj-a', 'proj-b'],
      capturedInsert,
      capturedUpdates,
    })

    const payloads = [
      payload('Alpha', 'scott@example.com'),
      payload('Beta', 'Emily Parker'),
    ]

    const result = await bulkImportProjects(client, { ...baseOpts, payloads })
    expect(result).toEqual({
      imported: 2,
      skipped: 0,
      projectIds: ['proj-a', 'proj-b'],
    })

    // Projects insert received resolved owner IDs + all the fields
    // buildProjectPayload emitted.
    expect(capturedInsert.rows).toHaveLength(2)
    expect(capturedInsert.rows![0]).toMatchObject({
      organization_id: 'org-1',
      source_report_id: 'report-1',
      name: 'Alpha',
      source: 'ado',
      external_id: 'Alpha',
      owner_id: 'user-scott',
    })
    expect(capturedInsert.rows![1]).toMatchObject({
      name: 'Beta',
      owner_id: 'user-emily',
    })

    // Anchor update inserted per project with matching health + the
    // synthesized summary.
    expect(capturedUpdates.rows).toHaveLength(2)
    expect(capturedUpdates.rows![0]).toMatchObject({
      organization_id: 'org-1',
      project_id: 'proj-a',
      author_id: 'user-scott',
      health: 'green',
    })
  })

  test('unresolved owner signal maps to owner_id: null (does not create users)', async () => {
    const capturedInsert: { rows?: Record<string, unknown>[] } = {}
    const client = makeClient({
      existingExternalIds: [],
      insertedIds: ['proj-x'],
      capturedInsert,
    })

    const result = await bulkImportProjects(client, {
      ...baseOpts,
      payloads: [payload('Alpha', 'stranger@nowhere.com')],
    })
    expect(result.imported).toBe(1)
    expect(capturedInsert.rows![0].owner_id).toBeNull()
  })

  test('dedup: already-imported external_ids are skipped', async () => {
    const capturedInsert: { rows?: Record<string, unknown>[] } = {}
    const client = makeClient({
      existingExternalIds: ['Alpha'],
      insertedIds: ['proj-b'],
      capturedInsert,
    })

    const result = await bulkImportProjects(client, {
      ...baseOpts,
      payloads: [payload('Alpha'), payload('Beta')],
    })
    expect(result).toEqual({
      imported: 1,
      skipped: 1,
      projectIds: ['proj-b'],
    })
    expect(capturedInsert.rows).toHaveLength(1)
    expect(capturedInsert.rows![0].name).toBe('Beta')
  })

  test('all payloads already imported: early-return with imported: 0 and no insert call', async () => {
    const capturedInsert: { rows?: Record<string, unknown>[] } = {}
    const client = makeClient({
      existingExternalIds: ['Alpha', 'Beta'],
      capturedInsert,
    })

    const result = await bulkImportProjects(client, {
      ...baseOpts,
      payloads: [payload('Alpha'), payload('Beta')],
    })
    expect(result).toEqual({
      imported: 0,
      skipped: 2,
      projectIds: [],
    })
    expect(capturedInsert.rows).toBeUndefined()
  })

  test('empty payload array short-circuits', async () => {
    const client = makeClient({})
    const result = await bulkImportProjects(client, { ...baseOpts, payloads: [] })
    expect(result).toEqual({ imported: 0, skipped: 0, projectIds: [] })
  })

  test('partial failure: updates insert fails but projects stay imported', async () => {
    const capturedInsert: { rows?: Record<string, unknown>[] } = {}
    const client = makeClient({
      existingExternalIds: [],
      insertedIds: ['proj-a'],
      capturedInsert,
      updatesInsertError: { message: 'pg exploded', code: 'X' },
    })

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await bulkImportProjects(client, {
      ...baseOpts,
      payloads: [payload('Alpha')],
    })
    expect(result).toEqual({
      imported: 1,
      skipped: 0,
      projectIds: ['proj-a'],
    })
    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })

  test('throws on projects existing-lookup error', async () => {
    const client = makeClient({
      existingError: { message: 'pg read failed', code: 'X' },
    })
    await expect(
      bulkImportProjects(client, {
        ...baseOpts,
        payloads: [payload('Alpha')],
      }),
    ).rejects.toMatchObject({ message: 'pg read failed' })
  })

  test('throws on projects insert error', async () => {
    const client = makeClient({
      existingExternalIds: [],
      insertError: { message: 'pg insert failed', code: 'X' },
    })
    await expect(
      bulkImportProjects(client, {
        ...baseOpts,
        payloads: [payload('Alpha')],
      }),
    ).rejects.toMatchObject({ message: 'pg insert failed' })
  })
})
