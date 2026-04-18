import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { ComputedProject } from '@/lib/file-processing/types'

export const runtime = 'nodejs'
export const maxDuration = 30

const bodySchema = z.object({
  reportId: z.string().uuid(),
})

const VALID_SOURCES = ['ado', 'jira', 'smartsheet', 'manual'] as const
type ProjectSource = (typeof VALID_SOURCES)[number]

function normalizeSource(value: unknown): ProjectSource {
  if (typeof value === 'string' && (VALID_SOURCES as readonly string[]).includes(value)) {
    return value as ProjectSource
  }
  return 'manual'
}

function isComputedProjectLike(v: unknown): v is Pick<ComputedProject, 'name' | 'health'> {
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
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return jsonError(
        'You need to be signed in to import projects.',
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
      console.error('import: profile lookup failed', profileError)
      return jsonError(
        'You need to be signed in to import projects.',
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

    const { reportId } = parsed.data

    const { data: report, error: reportError } = await supabase
      .from('status_reports')
      .select('id, content, source_file_name')
      .eq('id', reportId)
      .single()

    if (reportError || !report) {
      return jsonError(
        "We couldn't find that report.",
        'REPORT_NOT_FOUND',
        404,
      )
    }

    const content = report.content as {
      projects?: unknown
      source?: unknown
      meta?: { filename?: unknown }
    } | null

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

    const { data: existing, error: existingError } = await supabase
      .from('projects')
      .select('external_id')
      .eq('organization_id', organizationId)
      .eq('source_report_id', reportId)

    if (existingError) {
      console.error('import: existing projects lookup failed', existingError)
      return jsonError(
        "We couldn't check for already-imported projects.",
        'DB_READ_FAILED',
        500,
      )
    }

    const existingExternalIds = new Set(
      (existing ?? [])
        .map((r) => r.external_id)
        .filter((v): v is string => typeof v === 'string'),
    )

    const toInsert = validProjects
      .filter((p) => !existingExternalIds.has(p.name))
      .map((p) => ({
        organization_id: organizationId,
        name: p.name,
        description: null,
        status: 'active',
        health: p.health,
        source,
        external_id: p.name,
        source_report_id: reportId,
      }))

    const skipped = validProjects.length - toInsert.length

    if (toInsert.length === 0) {
      return Response.json({ imported: 0, skipped, projectIds: [] })
    }

    const { data: inserted, error: insertError } = await supabase
      .from('projects')
      .insert(toInsert)
      .select('id')

    if (insertError || !inserted) {
      console.error('import: batch insert failed', insertError)
      return jsonError(
        "We couldn't import these projects. Try again.",
        'DB_INSERT_FAILED',
        500,
      )
    }

    return Response.json({
      imported: inserted.length,
      skipped,
      projectIds: inserted.map((r) => r.id as string),
    })
  } catch (err) {
    console.error('import: unhandled error', err)
    return jsonError(
      'Something went wrong importing projects. Try again.',
      'INTERNAL',
      500,
    )
  }
}
