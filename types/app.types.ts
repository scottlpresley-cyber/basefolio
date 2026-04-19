// App-level types that build on the generated database row shapes.
// Keep the imported DB types private to this module — callers should
// reach for the exported app aliases (Project, NewProject, ProjectPatch)
// so the data layer has room to diverge from 1:1 row mappings later.

import type { Database } from './database.types'

type ProjectRow = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdateRow = Database['public']['Tables']['projects']['Update']

type ProjectUpdateRowFromDb = Database['public']['Tables']['project_updates']['Row']
type ProjectUpdateInsertFromDb =
  Database['public']['Tables']['project_updates']['Insert']

// Row shape + fields query helpers may attach server-side:
//   - owner_name resolved via the users join and displayName()
//   - last_update_at derived from the newest project_updates row
// Both are optional because not every helper attaches them
// (createProject returns the raw insert shape; listProjects attaches
// owner_name but not last_update_at; getProject attaches both).
export type Project = ProjectRow & {
  owner_name?: string | null
  last_update_at?: string | null
}

// Insert payload. organization_id is required by the DB (NOT NULL, no
// default) and the data layer forwards whatever the caller supplies —
// callers are expected to derive it from the authenticated session
// rather than trusting a value off the request body.
export type NewProject = ProjectInsert

// Patch shape for updates. organization_id and id are intentionally
// stripped — a PATCH must never rewrite the row's tenant, and the id
// is already carried by the URL/path, not the body.
export type ProjectPatch = Omit<ProjectUpdateRow, 'organization_id' | 'id'>

// A row from project_updates (the weekly status update entries) +
// the resolved author display name attached server-side via the
// users join in listProjectUpdates. author_name is null when the
// author's user row is missing or RLS hides it.
export type ProjectUpdate = ProjectUpdateRowFromDb & {
  author_name: string | null
}

// Insert payload for createProjectUpdate. Drops fields the caller
// must not control: id (DB generates), created_at (DB stamps),
// ai_risk_flags (populated by a downstream classify call, not by
// the form).
export type NewProjectUpdate = Omit<
  ProjectUpdateInsertFromDb,
  'id' | 'created_at' | 'ai_risk_flags'
>

export type ProjectHealth = 'green' | 'yellow' | 'red'
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'canceled'
