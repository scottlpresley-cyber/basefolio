// Typed read helpers for the projects table.
//
// Every function takes a SupabaseClient as its first argument. The
// caller chooses whether that client is user-scoped (RLS enforced)
// or service-role (RLS bypassed) — these helpers stay agnostic, which
// is what lets the same function back both a dashboard RSC and a
// webhook handler without branching logic.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { Project, ProjectStatus, ProjectUpdate } from '@/types/app.types'
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
//
// Two sequential queries:
//   1. projects + owner join — same shape as listProjects so the
//      detail page and the list view both resolve owner_name the
//      same way (via displayName's full_name -> email fallback).
//   2. Newest project_updates row for last_update_at — powers the
//      "Last update N days ago" line in the detail sidebar.
//
// Serial (not parallel) because the second query is wasted work
// whenever RLS hides the project; a null first result short-circuits.
// Returning a null last_update_at when no updates exist is the
// correct signal for "no updates yet".
export async function getProject(client: Client, id: string): Promise<Project | null> {
  const { data: project, error } = await client
    .from('projects')
    .select('*, owner:users!projects_owner_id_fkey(full_name, email)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!project) return null

  const { owner, ...rest } = project as typeof project & {
    owner: { full_name: string | null; email: string } | null
  }

  const { data: latestUpdate, error: updateErr } = await client
    .from('project_updates')
    .select('created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (updateErr) throw updateErr

  return {
    ...(rest as Project),
    owner_name: owner ? displayName(owner) : null,
    last_update_at: latestUpdate?.created_at ?? null,
  }
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

// Returns every status update for a project, newest first, with the
// author's display name resolved through the same displayName helper
// used by listProjects's owner column. RLS scopes the join — an
// author from a different org would surface as author_name: null
// rather than leaking their name.
//
// No pagination in MVP. Plan limits cap a Starter org at 15 active
// projects, and a typical update cadence is weekly — even after a
// year of heavy use a single project's feed is ~52 rows. If we need
// pagination later, the same shape (newest first) supports cursor.
export async function listProjectUpdates(
  client: Client,
  projectId: string,
): Promise<ProjectUpdate[]> {
  const { data, error } = await client
    .from('project_updates')
    .select('*, author:users!project_updates_author_id_fkey(full_name, email)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!data) return []

  return data.map((row) => {
    const { author, ...rest } = row as typeof row & {
      author: { full_name: string | null; email: string } | null
    }
    return {
      ...(rest as ProjectUpdate),
      author_name: author ? displayName(author) : null,
    }
  })
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
