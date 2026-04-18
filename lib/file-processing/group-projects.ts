import type { ColumnMap, ComputedProject, ParsedRow } from './types'

export interface ProjectGroup {
  name: string
  groupingKey: ComputedProject['groupingKey']
  rows: ParsedRow[]
}

const GROUPING_PRIORITY: Array<Exclude<ProjectGroup['groupingKey'], 'ungrouped'>> = [
  'area_path',
  'epic',
  'iteration',
  'tags',
]

/**
 * Group rows into projects by the first grouping field that has any values.
 *
 * Priority: area_path → epic → iteration → tags → "Ungrouped".
 *
 * For `tags` (typically comma or semicolon separated), rows are grouped by the
 * first non-empty tag. This is imperfect but predictable: a row appears under
 * its "primary" tag only. A row with no tags falls into "Ungrouped".
 *
 * Returns groups sorted largest-first.
 */
export function groupProjects(
  rows: ParsedRow[],
  columnMap: ColumnMap,
): ProjectGroup[] {
  if (rows.length === 0) return []

  for (const key of GROUPING_PRIORITY) {
    const header = columnMap[key]
    if (!header) continue
    const anyValue = rows.some((row) => firstTagOrValue(row[header], key).length > 0)
    if (!anyValue) continue

    const buckets = new Map<string, ParsedRow[]>()
    for (const row of rows) {
      const value = firstTagOrValue(row[header], key)
      const name = value.length > 0 ? value : 'Ungrouped'
      const arr = buckets.get(name) ?? []
      arr.push(row)
      buckets.set(name, arr)
    }

    const groups: ProjectGroup[] = Array.from(buckets.entries()).map(
      ([name, groupRows]) => ({ name, groupingKey: key, rows: groupRows }),
    )
    groups.sort((a, b) => b.rows.length - a.rows.length)
    return groups
  }

  return [{ name: 'Ungrouped', groupingKey: 'ungrouped', rows: [...rows] }]
}

function firstTagOrValue(
  raw: string | number | null | undefined,
  key: ProjectGroup['groupingKey'],
): string {
  if (raw === null || raw === undefined) return ''
  const str = typeof raw === 'number' ? String(raw) : raw
  const trimmed = str.trim()
  if (trimmed.length === 0) return ''
  if (key !== 'tags') return trimmed
  const first = trimmed.split(/[,;]/)[0]?.trim() ?? ''
  return first
}
