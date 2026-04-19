import { z } from 'zod'
import { callClaude } from '@/lib/ai/claude'
import {
  PORTFOLIO_ANALYST_SYSTEM,
  buildStatusDraftPrompt,
} from '@/lib/ai/prompts/status-draft'
import { computeProjectMetrics } from '@/lib/file-processing/compute-metrics'
import { parseErrorToResponse } from '@/lib/file-processing/error-response'
import { groupProjects } from '@/lib/file-processing/group-projects'
import { MAX_PROJECTS_PER_REPORT, parseFile } from '@/lib/file-processing/parse'
import {
  ParseError,
  type CanonicalField,
  type ColumnMap,
  type ComputedProject,
  type SourceTool,
} from '@/lib/file-processing/types'
import {
  enforceRateLimit,
  logAIUsageEvent,
  RateLimitExceededError,
} from '@/lib/rate-limit'
import {
  createClient,
  createServiceRoleClient,
} from '@/lib/supabase/server'

// Runtime: Node. maxDuration=60 requires Vercel Pro — hobby tier will
// timeout at 10s and streaming won't fully complete on long portfolios.
export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'status-draft-uploads'

const CANONICAL_FIELDS: readonly CanonicalField[] = [
  'title',
  'status',
  'assignee',
  'epic',
  'area_path',
  'iteration',
  'tags',
  'due_date',
  'completed_date',
  'work_item_type',
  'story_points',
] as const

const columnMapSchema = z
  .object(
    Object.fromEntries(
      CANONICAL_FIELDS.map((f) => [f, z.string().min(1).optional()]),
    ) as Record<CanonicalField, z.ZodOptional<z.ZodString>>,
  )
  .strict()

const bodySchema = z.object({
  storageKey: z.string().min(1),
  columnMap: columnMapSchema,
  originalFilename: z.string().min(1),
})

const SOURCE_HEADER_KEYS: Record<SourceTool, string[]> = {
  ado: ['Area Path', 'Iteration Path', 'Work Item Type'],
  jira: ['Issue Type', 'Epic Link', 'Sprint'],
  smartsheet: ['Row ID', 'Predecessors', 'Duration'],
  unknown: [],
}

function inferSourceFromMap(columnMap: ColumnMap, headers: string[]): SourceTool {
  const headerSet = new Set(headers)
  let best: { tool: SourceTool; hits: number } = { tool: 'unknown', hits: 0 }
  for (const tool of ['ado', 'jira', 'smartsheet'] as const) {
    const hits = SOURCE_HEADER_KEYS[tool].filter((h) => headerSet.has(h)).length
    if (hits > best.hits) best = { tool, hits }
  }
  return best.hits >= 2 ? best.tool : 'unknown'
}

function jsonError(
  message: string,
  code: string,
  status: number,
): Response {
  return Response.json({ error: message, code }, { status })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return jsonError(
        'You need to be signed in to generate a report.',
        'UNAUTHENTICATED',
        401,
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('generate: profile lookup failed', profileError)
      return jsonError(
        'You need to be signed in to generate a report.',
        'UNAUTHENTICATED',
        401,
      )
    }

    const organizationId = profile.organization_id as string

    // Rate gate: 5 generations per user per hour. Runs BEFORE the
    // Claude call and BEFORE heavy file parsing so a rate-limited
    // user doesn't pay for work they can't complete. Logged only on
    // success (below) so Anthropic errors don't count against quota.
    try {
      await enforceRateLimit(supabase, user.id, organizationId, {
        eventType: 'status_draft_generate',
        maxPerHour: 5,
      })
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return Response.json(
          {
            error: "You've hit the rate limit for report generation.",
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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid request.', 'BAD_REQUEST', 400)
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return jsonError('Invalid request.', 'BAD_REQUEST', 400)
    }

    const { storageKey, columnMap, originalFilename } = parsed.data

    if (!storageKey.startsWith(`${organizationId}/`)) {
      return jsonError(
        "That file isn't available to your organization.",
        'FORBIDDEN',
        403,
      )
    }

    const storage = createServiceRoleClient().storage.from(BUCKET)
    const { data: blob, error: downloadError } = await storage.download(storageKey)
    if (downloadError || !blob) {
      console.error('generate: storage download failed', downloadError)
      return jsonError(
        "We couldn't find that upload. Try uploading again.",
        'FILE_GONE',
        404,
      )
    }

    const buffer = Buffer.from(await blob.arrayBuffer())

    // Input cap: parseFile throws ROW_COUNT_EXCEEDED when > 5000 rows.
    // That cap is enforced at upload too, but re-parsing from storage
    // is a defense-in-depth check — a rogue storageKey wouldn't
    // have passed upload, but a future ingestion path might.
    let parsedFile: ReturnType<typeof parseFile>
    try {
      parsedFile = parseFile(buffer, originalFilename)
    } catch (err) {
      if (err instanceof ParseError) {
        const { status, body: errorBody } = parseErrorToResponse(err)
        return Response.json(errorBody, { status })
      }
      throw err
    }

    const groups = groupProjects(parsedFile.rows, columnMap)

    // Input cap: reject prompts that would stuff Claude with an
    // absurd number of distinct project sections. Business-tier
    // imports rarely exceed 40 projects; 100 is a generous ceiling.
    if (groups.length > MAX_PROJECTS_PER_REPORT) {
      return Response.json(
        {
          error: 'Your file produces too many projects for a single report.',
          detail: `Reports are capped at ${MAX_PROJECTS_PER_REPORT} grouped projects. Your file produced ${groups.length}. Filter the export to fewer area paths, epics, or iterations and try again.`,
          code: 'PROJECT_COUNT_EXCEEDED',
        },
        { status: 400 },
      )
    }

    const projects: ComputedProject[] = groups.map((g) =>
      computeProjectMetrics(g.name, g.groupingKey, g.rows, columnMap),
    )

    const source = inferSourceFromMap(columnMap, parsedFile.headers)
    const asOfDate = new Date().toISOString().slice(0, 10)

    const meta = { source, filename: originalFilename, asOfDate }

    const { data: inserted, error: insertError } = await supabase
      .from('status_reports')
      .insert({
        organization_id: organizationId,
        created_by: user.id,
        report_type: 'status_draft',
        title: null,
        period_start: null,
        period_end: null,
        content: {
          source,
          columnMap,
          projects,
          meta: { filename: originalFilename, asOfDate },
        },
        narrative: null,
        source_file_name: originalFilename,
        project_count: projects.length,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('generate: status_reports insert failed', insertError)
      return jsonError(
        "We couldn't save the report. Try again.",
        'DB_INSERT_FAILED',
        500,
      )
    }

    const reportId = inserted.id as string
    const prompt = buildStatusDraftPrompt(projects, meta)

    const claudeStream = await callClaude({
      model: 'narrative',
      system: PORTFOLIO_ANALYST_SYSTEM,
      prompt,
      maxTokens: 4000,
      stream: true,
    })

    const encoder = new TextEncoder()
    let accumulated = ''

    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        claudeStream.on('text', (delta: string) => {
          accumulated += delta
          try {
            controller.enqueue(encoder.encode(delta))
          } catch {
            // Controller may be closed if the client disconnected.
          }
        })
        claudeStream.on('error', (err) => {
          console.error('generate: claude stream error', err)
          try {
            controller.error(err)
          } catch {
            /* already closed */
          }
        })
        claudeStream.on('end', () => {
          try {
            controller.close()
          } catch {
            /* already closed */
          }

          // Log a successful AI usage event AFTER the stream closes,
          // so a failed generation doesn't count against the user's
          // rate limit. tokens_in/out and cost are null because the
          // stream API doesn't surface them cleanly; proper usage
          // accounting is a future prompt.
          void logAIUsageEvent(supabase, user.id, organizationId, {
            event_type: 'status_draft_generate',
            model: 'narrative',
            tokens_in: null,
            tokens_out: null,
            cost_usd: null,
          })

          // Persist narrative after the client stream closes. A failed save
          // is recoverable; a failed stream ruins the UX.
          void supabase
            .from('status_reports')
            .update({ narrative: accumulated })
            .eq('id', reportId)
            .then(({ error }) => {
              if (error) {
                console.error(
                  'generate: narrative update failed for report',
                  reportId,
                  error,
                )
              }
            })
        })
      },
      cancel() {
        claudeStream.abort()
      },
    })

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Report-Id': reportId,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('generate: unhandled error', err)
    return jsonError(
      'Something went wrong generating your report. Try again.',
      'INTERNAL',
      500,
    )
  }
}
