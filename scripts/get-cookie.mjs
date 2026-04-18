import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const projectRef = new URL(url).hostname.split('.')[0]

const c = createClient(url, anon, { auth: { persistSession: false } })
const { data, error } = await c.auth.signInWithPassword({
  email: process.env.TEST_EMAIL,
  password: process.env.TEST_PASSWORD,
})
if (error) { console.error(error); process.exit(1) }
const cookieValue = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64')
process.stdout.write(`sb-${projectRef}-auth-token=${cookieValue}`)
