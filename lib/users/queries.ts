// Typed read helpers for the users table. RLS enforces that a
// user-scoped client only sees rows in their own org, so none of
// these helpers need to filter by organization_id explicitly.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Client = SupabaseClient<Database>

export type OrgMember = {
  id: string
  full_name: string | null
  email: string
}

// Returns every user in the caller's org, newest first (by created_at).
// Used by the Add Project form for the owner select; future member
// management pages will use this too.
export async function listOrgMembers(client: Client): Promise<OrgMember[]> {
  const { data, error } = await client
    .from('users')
    .select('id, full_name, email')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as OrgMember[]
}
