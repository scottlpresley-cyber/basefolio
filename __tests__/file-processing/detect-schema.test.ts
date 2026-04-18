import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../../lib/file-processing/parse'
import { detectSchema } from '../../lib/file-processing/detect-schema'

const FIXTURES = join(__dirname, 'fixtures')

function headersFor(name: string): string[] {
  return parseFile(readFileSync(join(FIXTURES, name)), name).headers
}

describe('detectSchema', () => {
  it('detects ADO and maps required fields', () => {
    const r = detectSchema(headersFor('ado-sample.csv'))
    expect(r.source).toBe('ado')
    expect(r.confidence).toBeGreaterThan(0.5)
    expect(r.columnMap.title).toBe('Title')
    expect(r.columnMap.status).toBe('State')
    expect(r.columnMap.assignee).toBe('Assigned To')
    expect(r.columnMap.area_path).toBe('Area Path')
    expect(r.columnMap.iteration).toBe('Iteration Path')
    expect(r.missingRequired).toEqual([])
  })

  it('detects Jira and maps required fields', () => {
    const r = detectSchema(headersFor('jira-sample.csv'))
    expect(r.source).toBe('jira')
    expect(r.columnMap.title).toBe('Summary')
    expect(r.columnMap.status).toBe('Status')
    expect(r.columnMap.assignee).toBe('Assignee')
    expect(r.columnMap.epic).toBe('Epic Link')
    expect(r.columnMap.iteration).toBe('Sprint')
    expect(r.missingRequired).toEqual([])
  })

  it('falls back to unknown but still maps title + status via generics', () => {
    const r = detectSchema(headersFor('unknown-sample.csv'))
    expect(r.source).toBe('unknown')
    expect(r.confidence).toBe(0)
    expect(r.columnMap.title).toBeDefined()
    expect(r.columnMap.status).toBeDefined()
    expect(r.missingRequired).toEqual([])
  })

  it('flags missingRequired when no title/status can be found', () => {
    const r = detectSchema(['Foo', 'Bar'])
    expect(r.source).toBe('unknown')
    expect(r.missingRequired).toContain('title')
    expect(r.missingRequired).toContain('status')
  })
})
