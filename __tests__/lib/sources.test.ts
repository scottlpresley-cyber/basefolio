import { describe, expect, test } from 'vitest'
import { formatSource } from '@/lib/projects/sources'

describe('formatSource', () => {
  test('ado -> Azure DevOps', () => {
    expect(formatSource('ado')).toBe('Azure DevOps')
  })
  test('jira -> Jira', () => {
    expect(formatSource('jira')).toBe('Jira')
  })
  test('smartsheet -> Smartsheet', () => {
    expect(formatSource('smartsheet')).toBe('Smartsheet')
  })
  test('manual -> Created manually', () => {
    expect(formatSource('manual')).toBe('Created manually')
  })
  test('null -> —', () => {
    expect(formatSource(null)).toBe('—')
  })
  test('undefined -> —', () => {
    expect(formatSource(undefined)).toBe('—')
  })
  test('unknown string -> — (never leak the raw code)', () => {
    expect(formatSource('trello')).toBe('—')
  })
})
