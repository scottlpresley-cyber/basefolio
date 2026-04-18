// Shared fixtures for the RLS cross-tenant isolation suite.
//
// Every function in this file runs against the LIVE Supabase project —
// there is no local DB in this repo. Test runs create two real auth
// users and two real orgs, exercise the RLS policies with those
// sessions, then tear everything down.
//
// The service-role client is used only for setup, teardown, and
// verification reads (the "did the row actually change?" half of each
// deny assertion). It is never used inside a test's positive path —
// that would bypass RLS and prove nothing.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Vitest doesn't load .env.local (Vite's env loader is keyed to mode
// and .env.local is reserved for development mode). Load it by hand
// so SUPABASE_SERVICE_ROLE_KEY is available under process.env.
loadDotEnvLocal()

function loadDotEnvLocal() {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // .env.local absent; the skip guard in the test file catches missing keys.
  }
}

export const RLS_TEST_EMAIL_DOMAIN = 'basefolio.test'
export const RLS_TEST_EMAIL_PREFIX = 'rls-test-'
const TEST_PASSWORD = 'rls-test-password-' + randomUUID()

export const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

export function missingEnv(): string[] {
  return REQUIRED_ENV.filter((k) => !process.env[k])
}

function assertEnv() {
  const missing = missingEnv()
  if (missing.length) {
    throw new Error(`RLS fixtures: missing env vars: ${missing.join(', ')}`)
  }
}

export function serviceClient(): SupabaseClient {
  assertEnv()
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function anonClient(): SupabaseClient {
  assertEnv()
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export type TestOrg = {
  orgId: string
  userId: string
  userEmail: string
  userClient: SupabaseClient
}

export type SeedData = {
  projectId: string
  projectUpdateId: string
  milestoneId: string
  riskId: string
  statusReportId: string
  auditLogId: string
  aiUsageEventId: string
}

// Seed values chosen so the cross-tenant UPDATE deny tests can verify
// the field was NOT overwritten. The hijack payload writes a distinct
// 'HIJACKED' sentinel; post-attempt we read the row back via service
// role and expect to still see the 'seed' value here.
export const SEED_VALUES = {
  projectName: 'rls-test-project-seed',
  projectUpdateSummary: 'rls-test-update-seed',
  milestoneName: 'rls-test-milestone-seed',
  riskDescription: 'rls-test-risk-seed',
  statusReportTitle: 'rls-test-report-seed',
  auditLogAction: 'rls-test-audit-seed',
  aiUsageEventTokensIn: 100,
} as const

export const HIJACK_SENTINEL = 'rls-test-HIJACKED'

// Create a live tenant: auth user + org + profile (via the
// on_auth_user_created trigger) + a signed-in user client. The trigger
// fires synchronously inside the auth.users insert, so by the time
// admin.createUser resolves the org and public.users rows exist.
export async function createTestOrg(label: string): Promise<TestOrg> {
  const admin = serviceClient()
  const userEmail = `${RLS_TEST_EMAIL_PREFIX}${label}-${randomUUID().slice(0, 8)}@${RLS_TEST_EMAIL_DOMAIN}`

  const { data: createData, error: createErr } = await admin.auth.admin.createUser({
    email: userEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (createErr || !createData.user) {
    throw new Error(`createTestOrg(${label}): auth.admin.createUser failed: ${createErr?.message}`)
  }
  const userId = createData.user.id

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single()
  if (userErr || !userRow) {
    throw new Error(
      `createTestOrg(${label}): handle_new_user trigger did not populate users row for ${userId}: ${userErr?.message}`,
    )
  }
  const orgId = userRow.organization_id as string

  const userClient = anonClient()
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email: userEmail,
    password: TEST_PASSWORD,
  })
  if (signInErr) {
    throw new Error(`createTestOrg(${label}): signInWithPassword failed: ${signInErr.message}`)
  }

  return { orgId, userId, userEmail, userClient }
}

// Populate one row in every org-scoped table using the service-role
// client (bypasses RLS — this is setup, not a test assertion). Returns
// the generated row IDs so tests can target specific rows cross-tenant.
export async function seedOrgData(orgId: string, userId: string): Promise<SeedData> {
  const admin = serviceClient()

  const { data: project, error: projectErr } = await admin
    .from('projects')
    .insert({ organization_id: orgId, name: SEED_VALUES.projectName, owner_id: userId })
    .select('id')
    .single()
  if (projectErr || !project) throw new Error(`seedOrgData: projects insert: ${projectErr?.message}`)

  const { data: update, error: updateErr } = await admin
    .from('project_updates')
    .insert({
      organization_id: orgId,
      project_id: project.id,
      author_id: userId,
      health: 'green',
      summary: SEED_VALUES.projectUpdateSummary,
    })
    .select('id')
    .single()
  if (updateErr || !update) throw new Error(`seedOrgData: project_updates insert: ${updateErr?.message}`)

  const { data: milestone, error: milestoneErr } = await admin
    .from('milestones')
    .insert({
      organization_id: orgId,
      project_id: project.id,
      name: SEED_VALUES.milestoneName,
    })
    .select('id')
    .single()
  if (milestoneErr || !milestone) throw new Error(`seedOrgData: milestones insert: ${milestoneErr?.message}`)

  const { data: risk, error: riskErr } = await admin
    .from('risks')
    .insert({
      organization_id: orgId,
      project_id: project.id,
      description: SEED_VALUES.riskDescription,
    })
    .select('id')
    .single()
  if (riskErr || !risk) throw new Error(`seedOrgData: risks insert: ${riskErr?.message}`)

  const { data: report, error: reportErr } = await admin
    .from('status_reports')
    .insert({
      organization_id: orgId,
      created_by: userId,
      report_type: 'status_draft',
      title: SEED_VALUES.statusReportTitle,
      content: { marker: 'rls-test-seed' },
    })
    .select('id')
    .single()
  if (reportErr || !report) throw new Error(`seedOrgData: status_reports insert: ${reportErr?.message}`)

  const { data: audit, error: auditErr } = await admin
    .from('audit_log')
    .insert({
      organization_id: orgId,
      user_id: userId,
      action: SEED_VALUES.auditLogAction,
    })
    .select('id')
    .single()
  if (auditErr || !audit) throw new Error(`seedOrgData: audit_log insert: ${auditErr?.message}`)

  const { data: usage, error: usageErr } = await admin
    .from('ai_usage_events')
    .insert({
      organization_id: orgId,
      user_id: userId,
      event_type: 'classify',
      model: 'classify',
      tokens_in: SEED_VALUES.aiUsageEventTokensIn,
      tokens_out: 50,
      cost_usd: 0.0001,
    })
    .select('id')
    .single()
  if (usageErr || !usage) throw new Error(`seedOrgData: ai_usage_events insert: ${usageErr?.message}`)

  return {
    projectId: project.id as string,
    projectUpdateId: update.id as string,
    milestoneId: milestone.id as string,
    riskId: risk.id as string,
    statusReportId: report.id as string,
    auditLogId: audit.id as string,
    aiUsageEventId: usage.id as string,
  }
}

// Tear down both test orgs plus any leftover rows keyed to their org
// ids. Called from afterAll; also called from preCleanup to wipe
// stragglers from a previous crashed run.
export async function cleanupOrgs(orgIds: string[], userIds: string[]) {
  if (orgIds.length === 0 && userIds.length === 0) return
  const admin = serviceClient()

  const ORG_SCOPED_TABLES = [
    'project_updates',
    'milestones',
    'risks',
    'status_reports',
    'audit_log',
    'ai_usage_events',
    'projects',
  ] as const

  if (orgIds.length > 0) {
    for (const table of ORG_SCOPED_TABLES) {
      const { error } = await admin.from(table).delete().in('organization_id', orgIds)
      if (error) console.warn(`cleanupOrgs: delete from ${table} failed: ${error.message}`)
    }
  }

  // Deleting the auth user cascades to public.users via FK.
  for (const uid of userIds) {
    const { error } = await admin.auth.admin.deleteUser(uid)
    if (error) console.warn(`cleanupOrgs: deleteUser(${uid}) failed: ${error.message}`)
  }

  if (orgIds.length > 0) {
    const { error } = await admin.from('organizations').delete().in('id', orgIds)
    if (error) console.warn(`cleanupOrgs: delete organizations failed: ${error.message}`)
  }
}

// Defensive sweep run before tests start. Finds any straggling
// rls-test-*@basefolio.test auth users from a prior crashed run,
// looks up their org_ids, and runs the full cleanup against them.
export async function preCleanup() {
  const admin = serviceClient()

  const staleUserIds: string[] = []
  const staleEmails: string[] = []
  let page = 1
  // Paginate through auth users — listUsers has no server-side email
  // filter, so we scan and match the test domain in memory. 200 per
  // page is the cap on hosted Supabase.
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.warn(`preCleanup: listUsers page ${page} failed: ${error.message}`)
      break
    }
    for (const u of data.users) {
      if (
        typeof u.email === 'string' &&
        u.email.startsWith(RLS_TEST_EMAIL_PREFIX) &&
        u.email.endsWith(`@${RLS_TEST_EMAIL_DOMAIN}`)
      ) {
        staleUserIds.push(u.id)
        staleEmails.push(u.email)
      }
    }
    if (data.users.length < 200) break
    page++
  }

  // Resolve org ids before we delete the auth users (which cascades
  // the public.users rows we'd be looking up).
  const staleOrgIds: string[] = []
  if (staleUserIds.length > 0) {
    const { data: rows, error } = await admin
      .from('users')
      .select('organization_id')
      .in('id', staleUserIds)
    if (error) {
      console.warn(`preCleanup: users lookup failed: ${error.message}`)
    } else if (rows) {
      for (const r of rows) if (r.organization_id) staleOrgIds.push(r.organization_id as string)
    }
  }

  // Orgs whose on_auth_user_created-assigned name matches the test
  // domain (belt-and-suspenders for orgs whose users row was already
  // gone but org row survived).
  const { data: staleOrgs, error: orgLookupErr } = await admin
    .from('organizations')
    .select('id')
    .like('name', `${RLS_TEST_EMAIL_PREFIX}%@${RLS_TEST_EMAIL_DOMAIN}`)
  if (orgLookupErr) {
    console.warn(`preCleanup: organizations lookup failed: ${orgLookupErr.message}`)
  } else if (staleOrgs) {
    for (const o of staleOrgs) if (!staleOrgIds.includes(o.id)) staleOrgIds.push(o.id as string)
  }

  if (staleUserIds.length > 0 || staleOrgIds.length > 0) {
    console.warn(
      `preCleanup: wiping ${staleUserIds.length} stale user(s) and ${staleOrgIds.length} stale org(s)`,
    )
    await cleanupOrgs(staleOrgIds, staleUserIds)
  }
}
