import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
const projectRef = new URL(url).hostname.split('.')[0]

const fixtureName = process.argv[2] ?? 'ado-realistic.csv'
const fixturePath = `__tests__/file-processing/fixtures/${fixtureName}`
const outPath = process.argv[3] ?? `generated-${fixtureName.replace('.csv', '')}.md`

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
if (!profile) {
  const orgId = crypto.randomUUID()
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
const session = signIn.session

const cookieName = `sb-${projectRef}-auth-token`
const cookieValue = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64')
const cookieHeader = `${cookieName}=${cookieValue}`

// 1) Upload the fixture CSV
console.log('[upload]', fixturePath)
const csvBuf = readFileSync(fixturePath)
const fd = new FormData()
fd.append('file', new Blob([csvBuf], { type: 'text/csv' }), fixtureName)
const upRes = await fetch('http://localhost:3000/api/status-draft/upload', {
  method: 'POST',
  headers: { cookie: cookieHeader },
  body: fd,
})
console.log('upload status:', upRes.status)
const upBody = await upRes.json()
if (!upRes.ok) {
  console.error('upload failed:', upBody)
  process.exit(1)
}
console.log('source:', upBody.source, 'rows:', upBody.totalRowCount)
console.log('columnMap:', JSON.stringify(upBody.columnMap))

// 2) POST to generate, stream body
console.log('\n[generate]')
const t0 = Date.now()
const genRes = await fetch('http://localhost:3000/api/status-draft/generate', {
  method: 'POST',
  headers: { cookie: cookieHeader, 'content-type': 'application/json' },
  body: JSON.stringify({
    storageKey: upBody.storageKey,
    columnMap: upBody.columnMap,
    originalFilename: upBody.originalFilename,
  }),
})

console.log('status:', genRes.status)
console.log('X-Report-Id:', genRes.headers.get('X-Report-Id'))
console.log('Content-Type:', genRes.headers.get('Content-Type'))

if (!genRes.ok || !genRes.body) {
  const errText = await genRes.text()
  console.error('generate failed:', errText.slice(0, 500))
  process.exit(1)
}

const reader = genRes.body.getReader()
const decoder = new TextDecoder()
let full = ''
let firstTokenMs = null
let printed = 0
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const chunk = decoder.decode(value, { stream: true })
  if (firstTokenMs === null && chunk.length > 0) {
    firstTokenMs = Date.now() - t0
    console.log(`[first-token] ${firstTokenMs}ms`)
  }
  full += chunk
  if (printed < 200) {
    const take = Math.min(200 - printed, chunk.length)
    process.stdout.write(chunk.slice(0, take))
    printed += take
  }
}
const totalMs = Date.now() - t0
console.log(`\n[complete] total=${totalMs}ms length=${full.length}`)

writeFileSync(outPath, full)
console.log('wrote', outPath)

// 3) Verify the saved row
const reportId = genRes.headers.get('X-Report-Id')
if (reportId) {
  await new Promise((r) => setTimeout(r, 500))
  const { data: row } = await admin
    .from('status_reports')
    .select('id, project_count, source_file_name, created_at, narrative')
    .eq('id', reportId)
    .single()
  console.log('\n[status_reports row]')
  console.log('  id:', row.id)
  console.log('  project_count:', row.project_count)
  console.log('  source_file_name:', row.source_file_name)
  console.log('  created_at:', row.created_at)
  console.log('  narrative length:', row.narrative?.length ?? 0)
}
