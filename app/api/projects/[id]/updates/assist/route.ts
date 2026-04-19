// POST /api/projects/[id]/updates/assist — takes raw notes, returns
// a structured status-update draft via Claude Haiku.
//
// Contract:
//   200 { summary, accomplishments, next_steps, blockers, suggested_health }
//   400 { error, code, fields? }  — zod validation on notes failed
//   401 { error, code }           — unauthenticated
//   404 { error, code }           — project not in caller's org
//   429 { error, code, retry_after_seconds }  — user hit assist rate
//                                               cap (20/hour)
//   502 { error, code: 'AI_OUTPUT_PARSE_FAILED' }
//                                 — Claude returned text that didn't
//                                   parse as our JSON schema
//   500 { error, code }           — unexpected
//
// Rate limit, project ownership, org scoping, and ai_usage_events
// logging all follow the same patterns as the generate and updates
// routes. The one new thing is the Haiku call + strict JSON parse.

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/context'
import { getProject, listProjectUpdates } from '@/lib/projects/queries'
import { callClaude } from '@/lib/ai/claude'
import {
  STATUS_ASSIST_SYSTEM,
  buildStatusAssistPrompt,
  parseStatusAssistResponse,
} from '@/lib/ai/prompts/status-assist'
import {
  enforceRateLimit,
  logAIUsageEvent,
  RateLimitExceededError,
} from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 30

const bodySchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, 'Notes are required.')
    .max(10000, 'Notes must be 10,000 characters or fewer.'),
})

type FieldErrors = Record<string, string>

function jsonError(
  status: number,
  body: { error: string; code: string } & Record<string, unknown>,
): Response {
  return Response.json(body, { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params

    const supabase = await createClient()
    const auth = await getAuthContext(supabase)
    if (!auth) {
      return jsonError(401, {
        error: 'You need to be signed in to draft a status update.',
        code: 'UNAUTHENTICATED',
      })
    }

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return jsonError(400, { error: 'Invalid request body.', code: 'BAD_REQUEST' })
    }

    const parsed = bodySchema.safeParse(rawBody)
    if (!parsed.success) {
      const fields: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.')
        if (path && !(path in fields)) fields[path] = issue.message
      }
      return jsonError(400, {
        error: 'Some fields need attention.',
        code: 'VALIDATION_FAILED',
        fields,
      })
    }

    // Rate gate — 20/hour/user. Runs BEFORE the project lookup so
    // a saturated user doesn't pay for DB round-trips they can't
    // complete. Logged on success, not here.
    try {
      await enforceRateLimit(supabase, auth.userId, auth.orgId, {
        eventType: 'status_assist',
        maxPerHour: 20,
      })
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return Response.json(
          {
            error: "You've hit the rate limit for status drafting.",
            code: 'RATE_LIMIT_EXCEEDED',
            retry_after_seconds: err.retryAfterSeconds,
          },
          {
            status: 429,
            headers: { 'Retry-After': String(err.retryAfterSeconds) },
          },
        )
      }
      throw err
    }

    const project = await getProject(supabase, projectId)
    if (!project) {
      return jsonError(404, {
        error: 'Project not found.',
        code: 'PROJECT_NOT_FOUND',
      })
    }

    // Few-shot context: the most recent 3 updates' health + summary,
    // for voice consistency. Not "examples to copy" — the prompt
    // tells the model that explicitly.
    const recentUpdates = await listProjectUpdates(supabase, projectId, { limit: 3 })

    const prompt = buildStatusAssistPrompt({
      notes: parsed.data.notes,
      projectName: project.name,
      lastUpdates: recentUpdates.map((u) => ({ health: u.health, summary: u.summary })),
    })

    const message = await callClaude({
      model: 'classify',
      system: STATUS_ASSIST_SYSTEM,
      prompt,
      maxTokens: 1000,
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    const rawText = textBlock?.type === 'text' ? textBlock.text : ''

    const parsedAssist = parseStatusAssistResponse(rawText)
    if (!parsedAssist) {
      console.error(
        'assist: Claude response did not match expected schema. Raw:',
        rawText,
      )
      return jsonError(502, {
        error: 'The AI draft came back in an unexpected format. Try again.',
        code: 'AI_OUTPUT_PARSE_FAILED',
      })
    }

    // Log usage AFTER success so a parse failure doesn't count
    // against the user's quota. Token counts come from
    // message.usage when Anthropic provides them — classify tier
    // exposes input_tokens / output_tokens on non-streaming
    // responses.
    const usage = message.usage
    await logAIUsageEvent(supabase, auth.userId, auth.orgId, {
      event_type: 'status_assist',
      model: 'classify',
      tokens_in: usage?.input_tokens ?? null,
      tokens_out: usage?.output_tokens ?? null,
      cost_usd: null,
    })

    return Response.json(parsedAssist, { status: 200 })
  } catch (err) {
    console.error('POST /api/projects/[id]/updates/assist: unexpected error', err)
    return jsonError(500, {
      error: "Something went wrong on our end. Try again in a moment.",
      code: 'INTERNAL_ERROR',
    })
  }
}
