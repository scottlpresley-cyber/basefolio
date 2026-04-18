import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
const projectRef = new URL(url).hostname.split('.')[0]

const admin = createClient(url, svc, { auth: { persistSession: false } })

// Create (or reuse) a test user with known password
const testEmail = 'route-test@basefolio.test'
const testPassword = 'RouteTest!' + Date.now()

let userId
{
  const { data, error } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  })
  if (error && !String(error.message).includes('already')) throw error
  if (data?.user) userId = data.user.id
  if (!userId) {
    // look up existing
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
    userId = list.users.find(u => u.email === testEmail)?.id
    // force-set known password
    await admin.auth.admin.updateUserById(userId, { password: testPassword })
  }
}
console.log('test user id:', userId)

// Ensure public.users + org row exist (the on_auth_user_created trigger runs on INSERT,
// but if we only updated password, it already ran the first time). Check profile.
const { data: profile } = await admin.from('users').select('organization_id').eq('id', userId).maybeSingle()
if (!profile) {
  console.log('profile missing, inserting')
  const orgId = crypto.randomUUID()
  await admin.from('organizations').insert({ id: orgId, name: testEmail, slug: 'org-' + orgId.replace(/-/g,'').slice(0,12) })
  await admin.from('users').insert({ id: userId, organization_id: orgId, email: testEmail, role: 'owner' })
}

// Sign in to get access + refresh token
const anonClient = createClient(url, anon, { auth: { persistSession: false } })
const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({ email: testEmail, password: testPassword })
if (signInErr) throw signInErr
const session = signIn.session
console.log('got session, access_token len:', session.access_token.length)

// Build @supabase/ssr cookie. Format: `base64-` prefix + base64(JSON(session-object))
// Reference: node_modules/@supabase/ssr reading cookies
const cookieName = `sb-${projectRef}-auth-token`
const cookieValue = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64')

// Upload the fixture CSV
const csvBuf = readFileSync('__tests__/file-processing/fixtures/ado-sample.csv')
const fd = new FormData()
fd.append('file', new Blob([csvBuf], { type: 'text/csv' }), 'ado-sample.csv')

const res = await fetch('http://localhost:3000/api/status-draft/upload', {
  method: 'POST',
  headers: { cookie: `${cookieName}=${cookieValue}` },
  body: fd,
})
console.log('status:', res.status)
const body = await res.json()
console.log('response body:', JSON.stringify(body, null, 2).slice(0, 2500))

// List storage to confirm the file landed
if (body.storageKey) {
  const [org, user, filename] = body.storageKey.split('/')
  const { data: list, error: listErr } = await admin.storage.from('status-draft-uploads').list(`${org}/${user}`)
  console.log('storage listing for', `${org}/${user}`, ':', JSON.stringify(list, null, 2))
  if (listErr) console.log('list err', listErr)
}
