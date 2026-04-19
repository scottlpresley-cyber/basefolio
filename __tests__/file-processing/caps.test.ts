// Tests for the hard input caps — MAX_ROWS_PER_UPLOAD enforced in
// parse.ts, MAX_PROJECTS_PER_REPORT enforced inline in the generate
// route (tested there). These tests focus on the parse-time cap.

import { describe, test, expect } from 'vitest'
import {
  parseFile,
  MAX_ROWS_PER_UPLOAD,
  MAX_PROJECTS_PER_REPORT,
} from '@/lib/file-processing/parse'
import { ParseError } from '@/lib/file-processing/types'

function csvBuffer(rowCount: number): Buffer {
  const header = 'ID,Title,State\n'
  const rows: string[] = []
  for (let i = 1; i <= rowCount; i++) {
    rows.push(`${i},Item ${i},Active`)
  }
  return Buffer.from(header + rows.join('\n'), 'utf8')
}

describe('MAX_ROWS_PER_UPLOAD cap', () => {
  test('constant is 5000 as spec\'d', () => {
    expect(MAX_ROWS_PER_UPLOAD).toBe(5000)
  })

  test('MAX_PROJECTS_PER_REPORT is 100 as spec\'d', () => {
    expect(MAX_PROJECTS_PER_REPORT).toBe(100)
  })

  test('4999 rows: passes', () => {
    const result = parseFile(csvBuffer(4999), 'upload.csv')
    expect(result.rows).toHaveLength(4999)
  })

  test('exactly MAX_ROWS_PER_UPLOAD: passes (inclusive upper bound)', () => {
    const result = parseFile(csvBuffer(5000), 'upload.csv')
    expect(result.rows).toHaveLength(5000)
  })

  test('MAX+1 rows: throws ParseError with ROW_COUNT_EXCEEDED', () => {
    expect(() => parseFile(csvBuffer(5001), 'upload.csv')).toThrow(ParseError)
    try {
      parseFile(csvBuffer(5001), 'upload.csv')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError)
      expect((err as ParseError).code).toBe('ROW_COUNT_EXCEEDED')
      // The thrown error's message carries the row count so logs
      // and error responses can show the user what they submitted.
      expect((err as ParseError).message).toContain('5001')
      expect((err as ParseError).message).toContain('5000')
    }
  })

  test('well over the cap: still throws the right error (no OOM or hang)', () => {
    try {
      parseFile(csvBuffer(10000), 'upload.csv')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError)
      expect((err as ParseError).code).toBe('ROW_COUNT_EXCEEDED')
    }
  })
})
