// Typed write helpers for the projects table.
//
// These throw on any DB-level failure. Callers (route handlers) wrap
// them in their own error-response logic; the data layer does not
// know about HTTP.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type {
  Project,
  NewProject,
  ProjectPatch,
  ProjectHealth,
  ProjectUpdate,
  NewProjectUpdate,
  ProjectAuditEntry,
} from '@/types/app.types'
import { displayName } from '@/lib/users/display'
import type { ImportPayload } from '@/lib/file-processing/build-project-payload'
import type { OrgMember } from '@/lib/users/queries'

type Client = SupabaseClient<Database>

// organization_id lives inside `input`; the caller is responsible for
// deriving it from the authenticated session (never from a request
// body). Passing it through from a client-supplied value would be a
// tenant-confusion bug waiting to happen.
export async function createProject(client: Client, input: NewProject): Promise<Project> {
  const { data, error } = await client
    .from('projects')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// patch is typed to exclude organization_id and id so an UPDATE can
// never rewrite the row's tenant or swap the PK. Any such attempt
// fails at compile time.
export async function updateProject(
  client: Client,
  id: string,
  patch: ProjectPatch,
): Promise<Project> {
  const { data, error } = await client
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Health changes are audit-logged. Two sequential ops — the update
// and the audit insert — are not wrapped in a transaction for MVP;
// a failure of the audit insert after the update succeeds is logged
// and re-thrown. The follow-on risk is an unaudited health change,
// which we accept until we migrate this to a Postgres RPC in v2.
//
// Returns the updated project plus the full audit entry (not just an
// id) so callers can prepend the new entry to an Activity panel
// without a follow-up read. actor_name is resolved through the same
// displayName fallback used everywhere else.
export async function updateProjectHealth(
  client: Client,
  id: string,
  newHealth: ProjectHealth,
  actorId: string,
): Promise<{ project: Project; auditEntry: ProjectAuditEntry }> {
  const { data: current, error: readErr } = await client
    .from('projects')
    .select('health, organization_id')
    .eq('id', id)
    .single()
  if (readErr) throw readErr

  const oldHealth = current.health as ProjectHealth
  const organizationId = current.organization_id

  const { data: updated, error: updateErr } = await client
    .from('projects')
    .update({ health: newHealth })
    .eq('id', id)
    .select('*')
    .single()
  if (updateErr) throw updateErr

  const { data: audit, error: auditErr } = await client
    .from('audit_log')
    .insert({
      organization_id: organizationId,
      user_id: actorId,
      action: 'project.health_changed',
      entity_type: 'project',
      entity_id: id,
      old_value: { health: oldHealth },
      new_value: { health: newHealth },
    })
    .select(
      'id, action, old_value, new_value, created_at, actor:users!audit_log_user_id_fkey(full_name, email)',
    )
    .single()
  if (auditErr) {
    console.error(
      `updateProjectHealth: project ${id} health updated to ${newHealth} but audit_log insert failed`,
      auditErr,
    )
    throw auditErr
  }

  const { actor, ...rest } = audit as typeof audit & {
    actor: { full_name: string | null; email: string } | null
  }
  const auditEntry: ProjectAuditEntry = {
    id: rest.id as string,
    action: rest.action as string,
    actor_name: actor ? displayName(actor) : null,
    old_value: (rest.old_value ?? null) as Record<string, unknown> | null,
    new_value: (rest.new_value ?? null) as Record<string, unknown> | null,
    created_at: rest.created_at as string,
  }

  return { project: updated, auditEntry }
}

// Hard delete. FK cascades handle project_updates, milestones, risks.
// source_report_id on projects is ON DELETE SET NULL going the other
// way, so deleting the status_report doesn't wipe projects — only the
// reverse path here, which the DB doesn't need help with.
export async function deleteProject(client: Client, id: string): Promise<void> {
  const { error } = await client.from('projects').delete().eq('id', id)
  if (error) throw error
}

// Inserts a single status update. Returns the row plus the resolved
// author_name so callers can render it directly in an optimistic
// feed prepend without a follow-up read.
//
// organization_id, project_id, and author_id all live inside `input`
// — the route handler is responsible for setting them from the auth
// context and the URL param, never from the request body. The shape
// of NewProjectUpdate enforces id/created_at/ai_risk_flags can't be
// supplied at insert time.
export async function createProjectUpdate(
  client: Client,
  input: NewProjectUpdate,
): Promise<ProjectUpdate> {
  const { data, error } = await client
    .from('project_updates')
    .insert(input)
    .select('*, author:users!project_updates_author_id_fkey(full_name, email)')
    .single()
  if (error) throw error

  const { author, ...rest } = data as typeof data & {
    author: { full_name: string | null; email: string } | null
  }
  return {
    ...(rest as ProjectUpdate),
    author_name: author ? displayName(author) : null,
  }
}

// Resolves a free-text owner signal (mode of the assignee column) to
// a users.id in the caller's org. Tries email match first (case-
// insensitive), then exact-match on full_name. Returns null if no
// confident match — a wrong match would be worse than an unassigned
// project. Never creates users; that's the invite flow's job.
export function resolveOwnerIdFromSignal(
  signal: string | null,
  members: OrgMember[],
): string | null {
  if (!signal) return null
  const needle = signal.trim().toLowerCase()
  if (!needle) return null

  // Email-shape signals: "name@domain" or "Display Name <name@domain>".
  const emailMatch = needle.match(/([^\s<>]+@[^\s<>]+)/)
  if (emailMatch) {
    const email = emailMatch[1]
    const byEmail = members.find((m) => m.email.toLowerCase() === email)
    if (byEmail) return byEmail.id
  }

  // Fallback: exact case-insensitive full_name match.
  const byName = members.find(
    (m) => (m.full_name ?? '').trim().toLowerCase() === needle,
  )
  if (byName) return byName.id

  return null
}

export type BulkImportResult = {
  imported: number
  skipped: number
  projectIds: string[]
}

// Imports a batch of payloads into projects + seeds an initial
// project_updates row for each. Matches Sprint 1's return shape so
// the ReportStream UI doesn't need to change.
//
// Dedup: any payload whose external_id is already present under this
// source_report_id is skipped (and counted). Cross-report collisions
// are allowed — that's the whole point of the partial unique index
// from migration 20260417000005.
//
// Non-transactional: if the projects insert succeeds but a per-
// project updates insert fails, the project is still imported and
// the failure is logged. Same eventual-consistency posture as
// updateProjectHealth. A v2 migration would wrap this in a Postgres
// RPC if the failure rate ever becomes measurable.
export async function bulkImportProjects(
  client: Client,
  opts: {
    organizationId: string
    sourceReportId: string
    userId: string
    payloads: ImportPayload[]
    orgMembers: OrgMember[]
  },
): Promise<BulkImportResult> {
  const { organizationId, sourceReportId, userId, payloads, orgMembers } = opts

  if (payloads.length === 0) {
    return { imported: 0, skipped: 0, projectIds: [] }
  }

  // Per-report dedup lookup.
  const { data: existing, error: existingErr } = await client
    .from('projects')
    .select('external_id')
    .eq('organization_id', organizationId)
    .eq('source_report_id', sourceReportId)
  if (existingErr) throw existingErr

  const existingExternalIds = new Set(
    (existing ?? [])
      .map((r) => r.external_id)
      .filter((v): v is string => typeof v === 'string'),
  )

  const toInsert = payloads.filter(
    (p) => !existingExternalIds.has(p.project.external_id),
  )
  const skipped = payloads.length - toInsert.length

  if (toInsert.length === 0) {
    return { imported: 0, skipped, projectIds: [] }
  }

  const insertRows: NewProject[] = toInsert.map((p) => ({
    organization_id: organizationId,
    source_report_id: sourceReportId,
    name: p.project.name,
    description: p.project.description,
    phase: p.project.phase,
    health: p.project.health,
    status: p.project.status,
    source: p.project.source,
    external_id: p.project.external_id,
    target_end_date: p.project.target_end_date,
    owner_id: resolveOwnerIdFromSignal(p.project.inferredOwnerSignal, orgMembers),
  }))

  const { data: inserted, error: insertErr } = await client
    .from('projects')
    .insert(insertRows)
    .select('id')
  if (insertErr || !inserted) throw insertErr ?? new Error('bulkImportProjects: insert returned no rows')

  // Seed one initial status_update per imported project. If any of
  // these fail, the project is still imported — log and continue.
  const updateRows = inserted.map((row, i) => ({
    organization_id: organizationId,
    project_id: row.id as string,
    author_id: userId,
    health: toInsert[i].initialUpdate.health,
    summary: toInsert[i].initialUpdate.summary,
    period_start: null,
    period_end: null,
  }))

  const { error: updatesErr } = await client
    .from('project_updates')
    .insert(updateRows)
  if (updatesErr) {
    console.error(
      `bulkImportProjects: anchor updates insert failed for report ${sourceReportId}`,
      updatesErr,
    )
    // Proceed — projects are in, updates feed just won't have the
    // anchor entry. Better than failing the whole import.
  }

  return {
    imported: inserted.length,
    skipped,
    projectIds: inserted.map((r) => r.id as string),
  }
}
