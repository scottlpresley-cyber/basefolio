import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
const projectRef = new URL(url).hostname.split('.')[0]

const fixtureName = process.argv[2] ?? 'ado-realistic.csv'
const fixturePath = `__tests__/file-processing/fixtures/${fixtureName}`

const admin = createClient(url, svc, { auth: { persistSession: false } })

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
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
    userId = list.users.find((u) => u.email === testEmail)?.id
    await admin.auth.admin.updateUserById(userId, { password: testPassword })
  }
}

const { data: profile } = await admin
  .from('users')
  .select('organization_id')
  .eq('id', userId)
  .maybeSingle()
let orgId = profile?.organization_id
if (!profile) {
  orgId = crypto.randomUUID()
  await admin.from('organizations').insert({
    id: orgId,
    name: testEmail,
    slug: 'org-' + orgId.replace(/-/g, '').slice(0, 12),
  })
  await admin
    .from('users')
    .insert({ id: userId, organization_id: orgId, email: testEmail, role: 'owner' })
}

const anonClient = createClient(url, anon, { auth: { persistSession: false } })
const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
  email: testEmail,
  password: testPassword,
})
if (signInErr) throw signInErr

const cookieName = `sb-${projectRef}-auth-token`
const cookieValue =
  'base64-' + Buffer.from(JSON.stringify(signIn.session)).toString('base64')
const cookieHeader = `${cookieName}=${cookieValue}`

// 1) Upload
const csvBuf = readFileSync(fixturePath)
const fd = new FormData()
fd.append('file', new Blob([csvBuf], { type: 'text/csv' }), fixtureName)
const upRes = await fetch('http://localhost:3000/api/status-draft/upload', {
  method: 'POST',
  headers: { cookie: cookieHeader },
  body: fd,
})
const upBody = await upRes.json()
console.log('[upload] status=%d rows=%d', upRes.status, upBody.totalRowCount)

// 2) Generate (drain stream to completion, capture X-Report-Id)
const genRes = await fetch('http://localhost:3000/api/status-draft/generate', {
  method: 'POST',
  headers: { cookie: cookieHeader, 'content-type': 'application/json' },
  body: JSON.stringify({
    storageKey: upBody.storageKey,
    columnMap: upBody.columnMap,
    originalFilename: upBody.originalFilename,
  }),
})
const reportId = genRes.headers.get('X-Report-Id')
console.log('[generate] status=%d X-Report-Id=%s', genRes.status, reportId)
const reader = genRes.body.getReader()
while (true) {
  const { done } = await reader.read()
  if (done) break
}

// 3) Import — first call
console.log('\n[import #1]')
const imp1 = await fetch('http://localhost:3000/api/status-draft/import', {
  method: 'POST',
  headers: { cookie: cookieHeader, 'content-type': 'application/json' },
  body: JSON.stringify({ reportId }),
})
const imp1Body = await imp1.json()
console.log('  status:', imp1.status)
console.log('  body:', JSON.stringify(imp1Body, null, 2))

// 4) Confirm rows landed
const { data: rows } = await admin
  .from('projects')
  .select('id, name, health, source, external_id, source_report_id')
  .eq('organization_id', orgId)
  .eq('source_report_id', reportId)
  .order('name', { ascending: true })
console.log('\n[projects in db, filtered by source_report_id=' + reportId + ']')
console.log(JSON.stringify(rows, null, 2))

// 5) Idempotency — second call on same report
console.log('\n[import #2 — idempotency]')
const imp2 = await fetch('http://localhost:3000/api/status-draft/import', {
  method: 'POST',
  headers: { cookie: cookieHeader, 'content-type': 'application/json' },
  body: JSON.stringify({ reportId }),
})
const imp2Body = await imp2.json()
console.log('  status:', imp2.status)
console.log('  body:', JSON.stringify(imp2Body, null, 2))

const { count: finalCount } = await admin
  .from('projects')
  .select('id', { count: 'exact', head: true })
  .eq('organization_id', orgId)
  .eq('source_report_id', reportId)
console.log('  rows after #2:', finalCount)
