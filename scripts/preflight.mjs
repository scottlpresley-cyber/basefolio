#!/usr/bin/env node
// Validate required production env vars before `next build`.
// Skips locally; runs in CI (CI=true) or when NODE_ENV=production.
// Loads .env.local if present so local prod-mode builds mirror what
// `next build` sees, but will NOT override vars already set in the shell.
import { existsSync, readFileSync } from 'node:fs'

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
]

function shouldRun() {
  return process.env.NODE_ENV === 'production' || process.env.CI === 'true'
}

function loadEnvFileIfPresent(path) {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Shell env wins when it's actually set. An empty/whitespace value
    // is treated as unset so .env.local can fill it in — matches how
    // Next.js's own env loader behaves.
    const existing = process.env[key]
    if (existing === undefined || existing.trim() === '') {
      process.env[key] = value
    }
  }
}

if (!shouldRun()) {
  console.log('preflight skipped (not production or CI)')
  process.exit(0)
}

loadEnvFileIfPresent('.env.local')

const missing = REQUIRED.filter(
  (k) => !process.env[k] || process.env[k].trim() === '',
)

if (missing.length > 0) {
  console.error('preflight failed — missing required environment variables:')
  missing.forEach((name, i) => console.error(`  ${i + 1}. ${name}`))
  console.error(
    '\nSet these in your deploy environment (or .env.local for local prod builds).',
  )
  process.exit(1)
}

console.log('preflight ok')
