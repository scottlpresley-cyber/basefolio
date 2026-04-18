import { createClient } from '@supabase/supabase-js'
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: list } = await c.auth.admin.listUsers({ perPage: 200 })
const u = list.users.find(x => x.email === process.env.TEST_EMAIL)
if (!u) { console.error('no test user'); process.exit(1) }
const r = await c.auth.admin.updateUserById(u.id, { password: process.env.TEST_PASSWORD })
console.log('ok', u.id, r.error)
