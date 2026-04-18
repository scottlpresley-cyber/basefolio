export type SourceTool = 'ado' | 'jira' | 'smartsheet' | 'unknown'

export type CanonicalField =
  | 'title'
  | 'status'
  | 'assignee'
  | 'epic'
  | 'area_path'
  | 'iteration'
  | 'tags'
  | 'due_date'
  | 'completed_date'
  | 'work_item_type'
  | 'story_points'

export type ColumnMap = Partial<Record<CanonicalField, string>>

export interface DetectionResult {
  source: SourceTool
  confidence: number
  columnMap: ColumnMap
  unmappedHeaders: string[]
  missingRequired: CanonicalField[]
}

export type ParsedRow = Record<string, string | number | null>

export type NormalizedRow = Partial<Record<CanonicalField, string | null>>

export type ItemStatus =
  | 'complete'
  | 'in_progress'
  | 'blocked'
  | 'not_started'
  | 'unknown'

export interface ComputedProject {
  name: string
  groupingKey: 'area_path' | 'epic' | 'iteration' | 'tags' | 'ungrouped'
  itemCount: number
  statusCounts: Record<ItemStatus, number>
  percentComplete: number
  overdueCount: number
  blockedCount: number
  health: 'green' | 'yellow' | 'red'
  inferredOwner: string | null
  topItems: Array<{
    title: string
    status: ItemStatus
    assignee: string | null
  }>
}

export type ParseErrorCode =
  | 'EMPTY_FILE'
  | 'UNPARSEABLE'
  | 'NO_HEADERS'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'NO_REQUIRED_FIELDS'

export class ParseError extends Error {
  code: ParseErrorCode

  constructor(code: ParseErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
    this.name = 'ParseError'
  }
}
