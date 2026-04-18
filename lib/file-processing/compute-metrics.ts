import type {
  ColumnMap,
  ComputedProject,
  ItemStatus,
  ParsedRow,
} from './types'

const STATUS_BUCKETS: Record<Exclude<ItemStatus, 'unknown'>, string[]> = {
  complete: ['done', 'closed', 'resolved', 'complete', 'completed', 'shipped'],
  in_progress: [
    'in progress',
    'active',
    'doing',
    'started',
    'in review',
    'code review',
    'testing',
    'qa',
  ],
  blocked: ['blocked', 'on hold', 'waiting', 'impediment'],
  not_started: [
    'new',
    'to do',
    'todo',
    'open',
    'backlog',
    'not started',
    'proposed',
  ],
}

export function normalizeStatus(
  raw: string | null | undefined,
): ItemStatus {
  if (raw === null || raw === undefined) return 'unknown'
  const needle = String(raw).trim().toLowerCase()
  if (needle.length === 0) return 'unknown'
  for (const bucket of Object.keys(STATUS_BUCKETS) as Array<
    Exclude<ItemStatus, 'unknown'>
  >) {
    if (STATUS_BUCKETS[bucket].includes(needle)) return bucket
  }
  return 'unknown'
}

function cellToString(
  cell: string | number | null | undefined,
): string | null {
  if (cell === null || cell === undefined) return null
  const str = typeof cell === 'number' ? String(cell) : cell
  const trimmed = str.trim()
  return trimmed.length === 0 ? null : trimmed
}

function todayUtcDateOnly(): number {
  const now = new Date()
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
}

function isOverdue(
  dueRaw: string | number | null | undefined,
  status: ItemStatus,
  today: number,
): boolean {
  if (status === 'complete') return false
  const value = cellToString(dueRaw)
  if (value === null) return false
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return false
  return parsed < today
}

export function computeProjectMetrics(
  name: string,
  groupingKey: ComputedProject['groupingKey'],
  rows: ParsedRow[],
  columnMap: ColumnMap,
): ComputedProject {
  const titleCol = columnMap.title
  const statusCol = columnMap.status
  const assigneeCol = columnMap.assignee
  const dueCol = columnMap.due_date

  const itemCount = rows.length
  const today = todayUtcDateOnly()

  const statusCounts: Record<ItemStatus, number> = {
    complete: 0,
    in_progress: 0,
    blocked: 0,
    not_started: 0,
    unknown: 0,
  }

  let overdueCount = 0
  const assigneeCounts = new Map<string, number>()
  const perRow: Array<{
    title: string
    status: ItemStatus
    assignee: string | null
    overdue: boolean
  }> = []

  for (const row of rows) {
    const statusRaw = statusCol ? cellToString(row[statusCol]) : null
    const status = normalizeStatus(statusRaw)
    statusCounts[status]++

    const overdue = dueCol
      ? isOverdue(row[dueCol], status, today)
      : false
    if (overdue) overdueCount++

    const assignee = assigneeCol ? cellToString(row[assigneeCol]) : null
    if (assignee !== null) {
      assigneeCounts.set(assignee, (assigneeCounts.get(assignee) ?? 0) + 1)
    }

    const title =
      (titleCol ? cellToString(row[titleCol]) : null) ?? '(untitled)'

    perRow.push({ title, status, assignee, overdue })
  }

  const percentComplete =
    itemCount === 0 ? 0 : Math.round((statusCounts.complete / itemCount) * 100)

  const blockedCount = statusCounts.blocked

  let health: ComputedProject['health'] = 'green'
  if (itemCount > 0) {
    const blockedRatio = blockedCount / itemCount
    const overdueRatio = overdueCount / itemCount
    if (blockedRatio > 0.2 || overdueRatio > 0.2) health = 'red'
    else if (blockedRatio > 0.1 || overdueRatio > 0.1) health = 'yellow'
  }

  const inferredOwner = modeOrNull(assigneeCounts)

  const topItems = pickTopItems(perRow)

  return {
    name,
    groupingKey,
    itemCount,
    statusCounts,
    percentComplete,
    overdueCount,
    blockedCount,
    health,
    inferredOwner,
    topItems,
  }
}

function modeOrNull(counts: Map<string, number>): string | null {
  if (counts.size === 0) return null
  let topName: string | null = null
  let topCount = 0
  let tied = false
  for (const [name, count] of counts) {
    if (count > topCount) {
      topName = name
      topCount = count
      tied = false
    } else if (count === topCount) {
      tied = true
    }
  }
  return tied ? null : topName
}

function pickTopItems(
  perRow: Array<{
    title: string
    status: ItemStatus
    assignee: string | null
    overdue: boolean
  }>,
): ComputedProject['topItems'] {
  const priority = (r: {
    status: ItemStatus
    overdue: boolean
  }): number => {
    if (r.status === 'blocked') return 0
    if (r.overdue) return 1
    if (r.status === 'in_progress') return 2
    return 3
  }

  const indexed = perRow.map((r, i) => ({ ...r, i }))
  indexed.sort((a, b) => priority(a) - priority(b) || a.i - b.i)

  return indexed.slice(0, 10).map((r) => ({
    title: r.title,
    status: r.status,
    assignee: r.assignee,
  }))
}
