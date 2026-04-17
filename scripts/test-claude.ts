import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(process.cwd(), '.env.local')
try {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
} catch (err) {
  console.error(`Failed to read ${envPath}: ${(err as Error).message}`)
  process.exit(1)
}

async function main() {
  const { callClaude } = await import('../lib/ai/claude')
  const msg = await callClaude({
    model: 'classify',
    system: 'You answer with a single word.',
    prompt: 'Say OK.',
    maxTokens: 20,
  })
  const text = msg.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
  console.log(text)
}

main().catch((err) => {
  console.error(`test-claude failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
