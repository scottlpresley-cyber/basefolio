// Tests for lib/utils/date.formatDate. Relative-time cases pin
// "now" with vi.useFakeTimers so day-boundary arithmetic is
// reproducible.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { formatDate } from '@/lib/utils/date'

describe('formatDate — short', () => {
  test('formats an ISO string to "Apr 18, 2026"', () => {
    expect(formatDate('2026-04-18', 'short')).toBe('Apr 18, 2026')
  })

  test('accepts a full ISO timestamp', () => {
    expect(formatDate('2026-04-18T14:30:00Z', 'short')).toBe('Apr 18, 2026')
  })

  test('null returns —', () => {
    expect(formatDate(null, 'short')).toBe('—')
  })

  test('undefined returns —', () => {
    expect(formatDate(undefined, 'short')).toBe('—')
  })

  test('invalid date string returns — (no throw)', () => {
    expect(formatDate('not-a-date', 'short')).toBe('—')
  })

  test('defaults pattern to short when omitted', () => {
    expect(formatDate('2026-04-18')).toBe('Apr 18, 2026')
  })
})

describe('formatDate — relative', () => {
  beforeEach(() => {
    // Pin "now" to a fixed instant so day arithmetic is deterministic.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('same instant: "Today"', () => {
    expect(formatDate('2026-04-18T12:00:00Z', 'relative')).toBe('Today')
  })

  test('a few hours earlier today: "Today"', () => {
    expect(formatDate('2026-04-18T06:00:00Z', 'relative')).toBe('Today')
  })

  test('exactly 24 hours ago: "Yesterday"', () => {
    expect(formatDate('2026-04-17T12:00:00Z', 'relative')).toBe('Yesterday')
  })

  test('3 days ago: "3 days ago"', () => {
    expect(formatDate('2026-04-15T12:00:00Z', 'relative')).toBe('3 days ago')
  })

  test('exactly 6 days ago: "6 days ago"', () => {
    expect(formatDate('2026-04-12T12:00:00Z', 'relative')).toBe('6 days ago')
  })

  test('7 days ago: "1 week ago"', () => {
    expect(formatDate('2026-04-11T12:00:00Z', 'relative')).toBe('1 week ago')
  })

  test('14 days ago: "2 weeks ago"', () => {
    expect(formatDate('2026-04-04T12:00:00Z', 'relative')).toBe('2 weeks ago')
  })

  test('29 days ago: "4 weeks ago"', () => {
    expect(formatDate('2026-03-20T12:00:00Z', 'relative')).toBe('4 weeks ago')
  })

  test('30+ days ago: "on Mar 18"', () => {
    expect(formatDate('2026-03-18T12:00:00Z', 'relative')).toBe('on Mar 18')
  })

  test('future date: "on <short>"', () => {
    expect(formatDate('2026-05-01T12:00:00Z', 'relative')).toBe('on May 1')
  })

  test('null returns —', () => {
    expect(formatDate(null, 'relative')).toBe('—')
  })

  test('invalid date returns —', () => {
    expect(formatDate('not-a-date', 'relative')).toBe('—')
  })
})
