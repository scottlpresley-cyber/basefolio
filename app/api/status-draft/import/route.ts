// POST /api/status-draft/import — materializes a Status Draft report
// into real projects + anchor status updates. Thin handler on top of
// the bulkImportProjects mutation; the field-by-field population
// logic lives in lib/file-processing/build-project-payload.
//
// Wire shape intentionally unchanged from Sprint 1:
//   200 { imported, skipped, projectIds }
// The ReportStream UI consumes that directly — any drift here would
// cascade to the client. Updates to the response contract are
// deliberate, not incidental.

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/context'
import { bulkImportProjects } from '@/lib/projects/mutations'
import { listOrgMembers } from '@/lib/users/queries'
import { buildProjectPayload } from '@/lib/file-processing/build-project-payload'
import type { ComputedProject, SourceTool } from '@/lib/file-processing/types'

export const runtime = 'nodejs'
export const maxDuration = 30

const bodySchema = z.object({
  reportId: z.string().uuid(),
})

const VALID_SOURCES: ReadonlyArray<SourceTool> = [
  'ado',
  'jira',
  'smartsheet',
  'unknown',
]

function normalizeSource(value: unknown): SourceTool {
  if (typeof value === 'string' && VALID_SOURCES.includes(value as SourceTool)) {
    return value as SourceTool
  }
  return 'unknown'
}

// Permissive shape check — status_reports.content is jsonb populated
// from pre-compute; we validate each element has enough to synthesize
// a payload. Anything missing fields falls back gracefully inside
// buildProjectPayload.
function isComputedProjectLike(v: unknown): v is ComputedProject {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { name?: unknown }).name === 'string' &&
    typeof (v as { health?: unknown }).health === 'string'
  )
}

function jsonError(message: string, code: string, status: number): Response {
  return Response.json({ error: message, code }, { status })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await getAuthContext(supabase)
    if (!auth) {
      return jsonError(
        'You need to be signed in to import projects.',
        'UNAUTHENTICATED',
        401,
      )
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
    const { reportId } = parsed.data

    const { data: report, error: reportError } = await supabase
      .from('status_reports')
      .select('id, content, source_file_name')
      .eq('id', reportId)
      .single()
    if (reportError || !report) {
      return jsonError("We couldn't find that report.", 'REPORT_NOT_FOUND', 404)
    }

    const content = report.content as
      | {
          projects?: unknown
          source?: unknown
          meta?: { filename?: unknown; source?: unknown }
        }
      | null

    const rawProjects = content?.projects
    if (!Array.isArray(rawProjects)) {
      return jsonError(
        "That report doesn't contain project data we can import.",
        'INVALID_REPORT',
        422,
      )
    }

    const validProjects = rawProjects.filter(isComputedProjectLike)
    if (validProjects.length === 0) {
      return jsonError(
        "That report doesn't contain project data we can import.",
        'INVALID_REPORT',
        422,
      )
    }

    const source = normalizeSource(content?.source)
    // source_file_name is canonical on the status_reports row; the
    // content blob copies it under meta for self-containment.
    const sourceFileName =
      (report.source_file_name as string | null) ??
      (typeof content?.meta?.filename === 'string' ? content.meta.filename : null)

    const orgMembers = await listOrgMembers(supabase)

    const payloads = validProjects.map((project) =>
      buildProjectPayload({ project, source, sourceFileName }),
    )

    const result = await bulkImportProjects(supabase, {
      organizationId: auth.orgId,
      sourceReportId: reportId,
      userId: auth.userId,
      payloads,
      orgMembers,
    })

    return Response.json(result)
  } catch (err) {
    console.error('import: unhandled error', err)
    return jsonError(
      'Something went wrong importing projects. Try again.',
      'INTERNAL',
      500,
    )
  }
}
