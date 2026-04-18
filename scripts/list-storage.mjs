import { createClient } from '@supabase/supabase-js'
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const path = process.argv[2]
const { data, error } = await c.storage.from('status-draft-uploads').list(path, { sortBy: { column: 'created_at', order: 'desc' } })
console.log(JSON.stringify(data ?? error, null, 2))
