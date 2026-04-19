import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TEST_ORG_ID = '11111111-1111-4111-8111-111111111111'
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222'

const mockGetUser = vi.fn()
const mockSingle = vi.fn()
const mockStorageUpload = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ single: mockSingle }),
      }),
    }),
  }),
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({ upload: mockStorageUpload }),
    },
  }),
}))

// Import after mocks are registered (vi.mock is hoisted anyway).
import { POST } from '../../app/api/status-draft/upload/route'

const FIXTURES = join(__dirname, '..', 'file-processing', 'fixtures')

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name))
}

function buildRequest(file: File | null): Request {
  const body = new FormData()
  if (file) body.append('file', file, file.name)
  return new Request('http://test.local/api/status-draft/upload', {
    method: 'POST',
    body,
  })
}

function csvFile(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/csv' })
}

function fixtureFile(name: string): File {
  const buf = loadFixture(name)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new File([ab as ArrayBuffer], name, { type: 'text/csv' })
}

function authedDefaults() {
  mockGetUser.mockResolvedValue({ data: { user: { id: TEST_USER_ID } } })
  mockSingle.mockResolvedValue({
    data: { organization_id: TEST_ORG_ID },
    error: null,
  })
  mockStorageUpload.mockResolvedValue({ data: { path: 'ok' }, error: null })
}

describe('POST /api/status-draft/upload', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockSingle.mockReset()
    mockStorageUpload.mockReset()
  })

  it('parses an ADO CSV and returns a preview', async () => {
    authedDefaults()
    const res = await POST(buildRequest(fixtureFile('ado-sample.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('ado')
    expect(body.needsMapping).toBe(false)
    expect(body.totalRowCount).toBeGreaterThan(0)
    expect(body.preview.length).toBeLessThanOrEqual(20)
    expect(body.storageKey).toMatch(
      new RegExp(
        `^${TEST_ORG_ID}/${TEST_USER_ID}/[0-9a-f-]{36}-ado-sample\\.csv$`,
      ),
    )
    expect(mockStorageUpload).toHaveBeenCalledTimes(1)
  })

  it('parses a Jira CSV and returns source=jira', async () => {
    authedDefaults()
    const res = await POST(buildRequest(fixtureFile('jira-sample.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('jira')
  })

  it('returns source=unknown with confidence 0 for a generic CSV', async () => {
    authedDefaults()
    const res = await POST(buildRequest(fixtureFile('unknown-sample.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('unknown')
    expect(body.confidence).toBe(0)
  })

  it('returns 400 NO_FILE when no file field is present', async () => {
    authedDefaults()
    const res = await POST(buildRequest(null))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('NO_FILE')
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(buildRequest(fixtureFile('ado-sample.csv')))
    expect(res.status).toBe(401)
  })

  it('returns 400 UNSUPPORTED_FORMAT for a .txt file', async () => {
    authedDefaults()
    const res = await POST(
      buildRequest(
        new File(['hello world'], 'note.txt', { type: 'text/plain' }),
      ),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('UNSUPPORTED_FORMAT')
  })

  it('returns 400 EMPTY_FILE when a CSV has headers but no rows', async () => {
    authedDefaults()
    const res = await POST(
      buildRequest(csvFile('empty.csv', 'Title,Status\n')),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('EMPTY_FILE')
  })

  it('returns 500 STORAGE_FAILED when storage upload errors', async () => {
    authedDefaults()
    mockStorageUpload.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    const res = await POST(buildRequest(fixtureFile('ado-sample.csv')))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('STORAGE_FAILED')
  })

  it('returns 400 ROW_COUNT_EXCEEDED when the file has more than 5000 rows', async () => {
    authedDefaults()
    // Build a 5001-row CSV inline so the test doesn't depend on a
    // multi-megabyte fixture file.
    const header = 'ID,Title,State\n'
    const rows: string[] = []
    for (let i = 1; i <= 5001; i++) {
      rows.push(`${i},Item ${i},Active`)
    }
    const content = header + rows.join('\n')
    const res = await POST(buildRequest(csvFile('huge.csv', content)))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('ROW_COUNT_EXCEEDED')
    expect(body.error).toMatch(/5,000 rows|5000 rows/)
    // Storage upload must NOT be called — the cap fires before we
    // stage the file.
    expect(mockStorageUpload).not.toHaveBeenCalled()
  })
})
