// Typed write helpers for the projects table.
//
// These throw on any DB-level failure. Callers (route handlers) wrap
// them in their own error-response logic; the data layer does not
// know about HTTP.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { Project, NewProject, ProjectPatch, ProjectHealth } from '@/types/app.types'

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
export async function updateProjectHealth(
  client: Client,
  id: string,
  newHealth: ProjectHealth,
  actorId: string,
): Promise<{ project: Project; auditLogId: string }> {
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
    .select('id')
    .single()
  if (auditErr) {
    console.error(
      `updateProjectHealth: project ${id} health updated to ${newHealth} but audit_log insert failed`,
      auditErr,
    )
    throw auditErr
  }

  return { project: updated, auditLogId: audit.id }
}

// Hard delete. FK cascades handle project_updates, milestones, risks.
// source_report_id on projects is ON DELETE SET NULL going the other
// way, so deleting the status_report doesn't wipe projects — only the
// reverse path here, which the DB doesn't need help with.
export async function deleteProject(client: Client, id: string): Promise<void> {
  const { error } = await client.from('projects').delete().eq('id', id)
  if (error) throw error
}
