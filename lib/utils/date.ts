// Date formatting helpers used across the app. All are total
// functions — given a null or unparseable input they return "—"
// rather than throwing, so callers can render their result directly
// into the UI without guards.

export type DateFormatPattern = 'short' | 'relative'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

// Locale-stable short date ("Apr 18, 2026"). Uses en-US to keep
// dashboards consistent across clients regardless of their locale —
// changing this later to respect browser locale is a Sprint 4+
// localization concern.
function shortFormat(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function shortFormatNoYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Relative to "now" (wall-clock): "Today" / "Yesterday" / "N days ago"
// / "N weeks ago" / "on Apr 18". Buckets are 24-hour windows rather
// than calendar-day boundaries — good enough for MVP, worth revisiting
// if ops users ever complain about "Yesterday" at 2am.
function relativeFormat(d: Date, now: Date): string {
  const diff = now.getTime() - d.getTime()
  if (diff < 0) {
    // Future date — fall back to short form without the year.
    return `on ${shortFormatNoYear(d)}`
  }
  const days = Math.floor(diff / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const weeks = Math.floor(diff / WEEK_MS)
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  }
  return `on ${shortFormatNoYear(d)}`
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

// Parses either a date-only string ('YYYY-MM-DD') or a full ISO
// timestamp. Date-only values are anchored to local midnight rather
// than UTC — otherwise a project whose target_end_date is stored as
// '2026-04-18' would render as "Apr 17" for a user west of UTC,
// because Date("2026-04-18") parses as UTC midnight and then shifts
// backwards during local-timezone formatting.
function parseInput(value: string): Date {
  if (DATE_ONLY_RE.test(value)) return new Date(`${value}T00:00:00`)
  return new Date(value)
}

export function formatDate(
  value: string | null | undefined,
  pattern: DateFormatPattern = 'short',
): string {
  if (!value) return '—'
  const d = parseInput(value)
  if (Number.isNaN(d.getTime())) return '—'
  if (pattern === 'short') return shortFormat(d)
  return relativeFormat(d, new Date())
}
