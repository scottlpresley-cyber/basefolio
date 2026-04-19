// Unit tests for displayName — the single source of truth for how we
// render a user's name across the app.

import { describe, test, expect } from 'vitest'
import { displayName } from '@/lib/users/display'

describe('displayName', () => {
  test('returns full_name when present and non-empty', () => {
    expect(displayName({ full_name: 'Scott Presley', email: 'scott@example.com' })).toBe(
      'Scott Presley',
    )
  })

  test('trims surrounding whitespace on full_name', () => {
    expect(displayName({ full_name: '  Scott Presley  ', email: 'scott@example.com' })).toBe(
      'Scott Presley',
    )
  })

  test('falls back to email local-part when full_name is whitespace-only', () => {
    expect(displayName({ full_name: '   ', email: 'scott.l.presley@gmail.com' })).toBe(
      'scott.l.presley',
    )
  })

  test('falls back to email local-part when full_name is null', () => {
    expect(displayName({ full_name: null, email: 'scott.l.presley@gmail.com' })).toBe(
      'scott.l.presley',
    )
  })

  test('falls back to email local-part when full_name is undefined', () => {
    expect(displayName({ full_name: undefined, email: 'scott.l.presley@gmail.com' })).toBe(
      'scott.l.presley',
    )
  })

  test('falls back to email local-part when full_name key is absent entirely', () => {
    expect(displayName({ email: 'a.b@c.d' })).toBe('a.b')
  })

  test('strips everything from @ onward — no domain leaks into the fallback', () => {
    expect(displayName({ full_name: null, email: 'user+tag@mail.co.uk' })).toBe('user+tag')
  })
})
