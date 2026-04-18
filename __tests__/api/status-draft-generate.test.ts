import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'
const TEST_REPORT_ID = '99999999-9999-4999-8999-999999999999'

const mockGetUser = vi.fn()
const mockUserSingle = vi.fn()

const mockInsertBuilder = {
  select: vi.fn(),
  single: vi.fn(),
}

const mockFrom = vi.fn()
const mockStorageDownload = vi.fn()
const mockCallClaude = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({ download: mockStorageDownload }),
    },
  }),
}))

vi.mock('@/lib/ai/claude', () => ({
  callClaude: (...args: unknown[]) => mockCallClaude(...args),
}))

// Import after mocks register.
import { POST } from '../../app/api/status-draft/generate/route'

const FIXTURES = join(__dirname, '..', 'file-processing', 'fixtures')

function loadFixtureBuffer(name: string): Buffer {
  return readFileSync(join(FIXTURES, name))
}

function buildRequest(body: unknown, raw = false): Request {
  return new Request('http://test.local/api/status-draft/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    storageKey: `${TEST_ORG_ID}/${TEST_USER_ID}/abc-ado-sample.csv`,
    originalFilename: 'ado-sample.csv',
    columnMap: {
      title: 'Title',
      status: 'State',
      assignee: 'Assigned To',
      area_path: 'Area Path',
    },
    ...overrides,
  }
}

function fixtureBlob(name: string) {
  const buf = loadFixtureBuffer(name)
  return {
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
}

interface MockStreamOptions {
  chunks: string[]
  errorAfter?: number
  capturedUpdate?: { narrative?: string | null }
}

function makeMockClaudeStream({
  chunks,
  errorAfter,
}: MockStreamOptions) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const stream = {
    on(event: string, handler: (...args: unknown[]) => void) {
      const arr = handlers.get(event) ?? []
      arr.push(handler)
      handlers.set(event, arr)
      return stream
    },
    abort: vi.fn(),
  }
  setTimeout(() => {
    const textHandlers = handlers.get('text') ?? []
    const errHandlers = handlers.get('error') ?? []
    const endHandlers = handlers.get('end') ?? []
    for (let i = 0; i < chunks.length; i++) {
      if (errorAfter !== undefined && i === errorAfter) {
        for (const h of errHandlers) h(new Error('claude broke mid-stream'))
        return
      }
      for (const h of textHandlers) h(chunks[i])
    }
    if (errorAfter === chunks.length) {
      for (const h of errHandlers) h(new Error('claude broke mid-stream'))
      return
    }
    for (const h of endHandlers) h()
  }, 0)
  return stream
}

async function readFullBody(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    try {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    } catch {
      break
    }
  }
  text += decoder.decode()
  return text
}

function installFromRouter(
  options: {
    insertError?: unknown
    capturedInsert?: { payload?: Record<string, unknown> }
    capturedUpdate?: { narrative?: string | null; reportId?: string }
  } = {},
) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({ single: mockUserSingle }),
        }),
      }
    }
    if (table === 'status_reports') {
      return {
        insert: (payload: Record<string, unknown>) => {
          if (options.capturedInsert) options.capturedInsert.payload = payload
          return {
            select: () => ({
              single: async () =>
                options.insertError
                  ? { data: null, error: options.insertError }
                  : { data: { id: TEST_REPORT_ID }, error: null },
            }),
          }
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            if (options.capturedUpdate) {
              options.capturedUpdate.narrative = payload.narrative as
                | string
                | null
              options.capturedUpdate.reportId = id
            }
            return Promise.resolve({ error: null }).then((r) => r)
          },
        }),
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })
}

function installAuthedDefaults() {
  mockGetUser.mockResolvedValue({ data: { user: { id: TEST_USER_ID } } })
  mockUserSingle.mockResolvedValue({
    data: { organization_id: TEST_ORG_ID },
    error: null,
  })
  mockStorageDownload.mockResolvedValue({
    data: fixtureBlob('ado-sample.csv'),
    error: null,
  })
}

describe('POST /api/status-draft/generate', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockUserSingle.mockReset()
    mockFrom.mockReset()
    mockStorageDownload.mockReset()
    mockCallClaude.mockReset()
    mockInsertBuilder.select.mockReset()
    mockInsertBuilder.single.mockReset()
  })

  it('streams narrative text, writes X-Report-Id, and persists the full narrative', async () => {
    installAuthedDefaults()
    const captured: { narrative?: string | null; reportId?: string } = {}
    installFromRouter({ capturedUpdate: captured })

    const chunks = ['# Report\n\n', 'The portfolio ', 'is mostly green.']
    mockCallClaude.mockResolvedValue(makeMockClaudeStream({ chunks }))

    const res = await POST(buildRequest(validBody()))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Report-Id')).toBe(TEST_REPORT_ID)
    expect(res.headers.get('Content-Type')).toMatch(/text\/plain/)

    const text = await readFullBody(res.body!)
    expect(text).toBe(chunks.join(''))

    // Allow the update .then() to flush.
    await new Promise((r) => setTimeout(r, 10))
    expect(captured.narrative).toBe(chunks.join(''))
    expect(captured.reportId).toBe(TEST_REPORT_ID)
  })

  it('inserts a status_reports row with report_type status_draft and project_count', async () => {
    installAuthedDefaults()
    const capturedInsert: { payload?: Record<string, unknown> } = {}
    installFromRouter({ capturedInsert })

    mockCallClaude.mockResolvedValue(makeMockClaudeStream({ chunks: ['ok'] }))

    const res = await POST(buildRequest(validBody()))
    expect(res.status).toBe(200)
    await readFullBody(res.body!)

    expect(capturedInsert.payload?.report_type).toBe('status_draft')
    expect(capturedInsert.payload?.organization_id).toBe(TEST_ORG_ID)
    expect(capturedInsert.payload?.created_by).toBe(TEST_USER_ID)
    expect(capturedInsert.payload?.source_file_name).toBe('ado-sample.csv')
    expect(typeof capturedInsert.payload?.project_count).toBe('number')
    expect(capturedInsert.payload?.narrative).toBeNull()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(buildRequest(validBody()))
    expect(res.status).toBe(401)
  })

  it('returns 400 BAD_REQUEST when columnMap is missing', async () => {
    installAuthedDefaults()
    installFromRouter()
    const res = await POST(
      buildRequest({
        storageKey: `${TEST_ORG_ID}/x/a.csv`,
        originalFilename: 'a.csv',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 400 BAD_REQUEST when the body is not JSON', async () => {
    installAuthedDefaults()
    installFromRouter()
    const res = await POST(buildRequest('not-json', true))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('returns 403 FORBIDDEN when storageKey prefix mismatches org', async () => {
    installAuthedDefaults()
    installFromRouter()
    const res = await POST(
      buildRequest(
        validBody({
          storageKey: 'other-org-id/some-user/xxx-a.csv',
        }),
      ),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
  })

  it('returns 404 FILE_GONE when storage download fails', async () => {
    installAuthedDefaults()
    installFromRouter()
    mockStorageDownload.mockResolvedValue({
      data: null,
      error: { message: 'not found' },
    })
    const res = await POST(buildRequest(validBody()))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('FILE_GONE')
  })

  it('does not persist narrative when the claude stream errors mid-flight', async () => {
    installAuthedDefaults()
    const captured: { narrative?: string | null; reportId?: string } = {}
    installFromRouter({ capturedUpdate: captured })

    mockCallClaude.mockResolvedValue(
      makeMockClaudeStream({
        chunks: ['partial '],
        errorAfter: 1,
      }),
    )

    const res = await POST(buildRequest(validBody()))
    expect(res.status).toBe(200)
    const text = await readFullBody(res.body!)
    expect(text).toContain('partial ')

    await new Promise((r) => setTimeout(r, 10))
    // Stream erred — route wires narrative save to 'end', which never fired.
    expect(captured.narrative).toBeUndefined()
  })
})
