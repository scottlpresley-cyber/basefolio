// Typed read helpers for the projects table.
//
// Every function takes a SupabaseClient as its first argument. The
// caller chooses whether that client is user-scoped (RLS enforced)
// or service-role (RLS bypassed) — these helpers stay agnostic, which
// is what lets the same function back both a dashboard RSC and a
// webhook handler without branching logic.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { Project, ProjectStatus } from '@/types/app.types'
import { displayName } from '@/lib/users/display'

type Client = SupabaseClient<Database>

// Default: only active projects. Pass opts.status = undefined (i.e.
// `{ status: undefined }`) to read every status; pass a specific
// value to filter to that one. Omitting opts keeps the default.
//
// Joins users via the projects.owner_id FK so the caller gets
// owner_name alongside the raw row — avoids N+1 name lookups in the
// projects list and future dashboard grid. The join respects RLS:
// users-table SELECT policy is org-scoped, so a project whose
// owner_id points somewhere unreadable comes back with owner_name
// null rather than leaking cross-org names.
//
// owner_name is derived via displayName() so every surface (this
// query, the sidebar, the form select) uses the same full_name ->
// email-local-part fallback. A null owner_id (unassigned project)
// still maps to null; a real owner always maps to a real string.
export async function listProjects(
  client: Client,
  opts?: { status?: ProjectStatus },
): Promise<Project[]> {
  const status: ProjectStatus | undefined = opts === undefined ? 'active' : opts.status

  let query = client
    .from('projects')
    .select('*, owner:users!projects_owner_id_fkey(full_name, email)')
    .order('created_at', { ascending: false })

  if (status !== undefined) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) throw error
  if (!data) return []

  return data.map((row) => {
    const { owner, ...rest } = row as typeof row & {
      owner: { full_name: string | null; email: string } | null
    }
    const owner_name = owner ? displayName(owner) : null
    return { ...(rest as Project), owner_name }
  })
}

// Returns null on both "row does not exist" and "RLS hid the row" —
// the caller decides whether that becomes a 404 or a 403. Using
// maybeSingle instead of single so zero rows isn't an error.
export async function getProject(client: Client, id: string): Promise<Project | null> {
  const { data, error } = await client
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

// Backs the Status Draft import flow's "view imported" confirmation
// and future report-detail pages.
export async function getProjectsBySourceReport(
  client: Client,
  reportId: string,
): Promise<Project[]> {
  const { data, error } = await client
    .from('projects')
    .select('*')
    .eq('source_report_id', reportId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Used by the plan-limit gate before createProject. count: 'exact' +
// head: true avoids transferring row data — we only need the number.
export async function countActiveProjects(client: Client): Promise<number> {
  const { count, error } = await client
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
  if (error) throw error
  return count ?? 0
}
