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
