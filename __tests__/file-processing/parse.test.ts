import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../../lib/file-processing/parse'
import { ParseError } from '../../lib/file-processing/types'

const FIXTURES = join(__dirname, 'fixtures')

function load(name: string): Buffer {
  return readFileSync(join(FIXTURES, name))
}

describe('parseFile', () => {
  it('parses ado-sample.csv', () => {
    const { headers, rows } = parseFile(load('ado-sample.csv'), 'ado-sample.csv')
    expect(headers).toContain('Title')
    expect(headers).toContain('Area Path')
    expect(rows).toHaveLength(15)
    expect(rows[0].Title).toBe('Set up CI pipeline')
  })

  it('parses jira-sample.csv', () => {
    const { headers, rows } = parseFile(
      load('jira-sample.csv'),
      'jira-sample.csv',
    )
    expect(headers).toContain('Summary')
    expect(headers).toContain('Epic Link')
    expect(rows).toHaveLength(12)
  })

  it('parses unknown-sample.csv', () => {
    const { headers, rows } = parseFile(
      load('unknown-sample.csv'),
      'unknown-sample.csv',
    )
    expect(headers).toEqual(['Task', 'State', 'Owner', 'Due'])
    expect(rows).toHaveLength(8)
  })

  it('throws EMPTY_FILE when CSV has only headers', () => {
    const buf = Buffer.from('Title,Status\n')
    expect(() => parseFile(buf, 'empty.csv')).toThrowError(ParseError)
    try {
      parseFile(buf, 'empty.csv')
    } catch (err) {
      expect((err as ParseError).code).toBe('EMPTY_FILE')
    }
  })

  it('throws UNSUPPORTED_FORMAT for a .txt filename', () => {
    try {
      parseFile(Buffer.from('hello'), 'note.txt')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError)
      expect((err as ParseError).code).toBe('UNSUPPORTED_FORMAT')
    }
  })

  it('throws NO_HEADERS when first row is blank', () => {
    const buf = Buffer.from('   ,   \nfoo,bar\n')
    try {
      parseFile(buf, 'bad.csv')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError)
      expect((err as ParseError).code).toBe('NO_HEADERS')
    }
  })
})
