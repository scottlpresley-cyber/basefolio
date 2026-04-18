import { z } from 'zod'
import { callClaude } from '@/lib/ai/claude'
import {
  PORTFOLIO_ANALYST_SYSTEM,
  buildStatusDraftPrompt,
} from '@/lib/ai/prompts/status-draft'
import { computeProjectMetrics } from '@/lib/file-processing/compute-metrics'
import { groupProjects } from '@/lib/file-processing/group-projects'
import { parseFile } from '@/lib/file-processing/parse'
import type {
  CanonicalField,
  ColumnMap,
  ComputedProject,
  SourceTool,
} from '@/lib/file-processing/types'
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
    const parsedFile = parseFile(buffer, originalFilename)

    const groups = groupProjects(parsedFile.rows, columnMap)
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
