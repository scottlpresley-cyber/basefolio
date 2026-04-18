import { randomUUID } from 'node:crypto'
import { detectSchema } from '@/lib/file-processing/detect-schema'
import { parseErrorToResponse } from '@/lib/file-processing/error-response'
import { parseFile } from '@/lib/file-processing/parse'
import { ParseError } from '@/lib/file-processing/types'
import {
  createClient,
  createServiceRoleClient,
} from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_SIZE_BYTES = 10 * 1024 * 1024
const PREVIEW_ROW_COUNT = 20
const BUCKET = 'status-draft-uploads'

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'upload'
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json(
        { error: 'You need to be signed in to upload a file.' },
        { status: 401 },
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('upload: user profile lookup failed', profileError)
      return Response.json(
        { error: 'You need to be signed in to upload a file.' },
        { status: 401 },
      )
    }

    const organizationId = profile.organization_id

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return Response.json(
        { error: 'No file was uploaded.', code: 'NO_FILE' },
        { status: 400 },
      )
    }

    const fileField = formData.get('file')
    if (!fileField || !(fileField instanceof File)) {
      return Response.json(
        { error: 'No file was uploaded.', code: 'NO_FILE' },
        { status: 400 },
      )
    }

    const file = fileField

    if (file.size > MAX_SIZE_BYTES) {
      return Response.json(
        {
          error:
            'File is over 10 MB. Export a smaller slice or split it by team or quarter.',
          code: 'TOO_LARGE',
        },
        { status: 413 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    let parsed
    try {
      parsed = parseFile(buffer, file.name)
    } catch (err) {
      if (err instanceof ParseError) {
        const { status, body } = parseErrorToResponse(err)
        return Response.json(body, { status })
      }
      throw err
    }

    const detection = detectSchema(parsed.headers)

    const storage = createServiceRoleClient().storage.from(BUCKET)
    const safeName = sanitizeFilename(file.name)
    const storageKey = `${organizationId}/${user.id}/${randomUUID()}-${safeName}`

    const { error: uploadError } = await storage.upload(storageKey, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

    if (uploadError) {
      console.error('upload: storage upload failed', uploadError)
      return Response.json(
        {
          error: "We couldn't stage your file for processing. Try again.",
          code: 'STORAGE_FAILED',
        },
        { status: 500 },
      )
    }

    return Response.json({
      storageKey,
      originalFilename: file.name,
      source: detection.source,
      confidence: detection.confidence,
      headers: parsed.headers,
      columnMap: detection.columnMap,
      unmappedHeaders: detection.unmappedHeaders,
      missingRequired: detection.missingRequired,
      totalRowCount: parsed.rows.length,
      preview: parsed.rows.slice(0, PREVIEW_ROW_COUNT),
      needsMapping: detection.missingRequired.length > 0,
    })
  } catch (err) {
    console.error('upload: unhandled error', err)
    return Response.json(
      {
        error: 'Something went wrong processing your file. Try again.',
        code: 'INTERNAL',
      },
      { status: 500 },
    )
  }
}
