// App-level types that build on the generated database row shapes.
// Keep the imported DB types private to this module — callers should
// reach for the exported app aliases (Project, NewProject, ProjectPatch)
// so the data layer has room to diverge from 1:1 row mappings later.

import type { Database } from './database.types'

type ProjectRow = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']

// Row shape + owner_name that query helpers may attach when they join
// against the users table. Optional because not every helper does the
// join (createProject returns the raw insert shape, for example).
export type Project = ProjectRow & { owner_name?: string | null }

// Insert payload. organization_id is required by the DB (NOT NULL, no
// default) and the data layer forwards whatever the caller supplies —
// callers are expected to derive it from the authenticated session
// rather than trusting a value off the request body.
export type NewProject = ProjectInsert

// Patch shape for updates. organization_id and id are intentionally
// stripped — a PATCH must never rewrite the row's tenant, and the id
// is already carried by the URL/path, not the body.
export type ProjectPatch = Omit<ProjectUpdate, 'organization_id' | 'id'>

export type ProjectHealth = 'green' | 'yellow' | 'red'
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'canceled'
