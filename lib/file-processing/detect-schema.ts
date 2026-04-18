import type {
  CanonicalField,
  ColumnMap,
  DetectionResult,
  SourceTool,
} from './types'

const SOURCE_SIGNATURES: Record<Exclude<SourceTool, 'unknown'>, string[]> = {
  ado: ['Area Path', 'Iteration Path', 'Work Item Type', 'Assigned To'],
  jira: ['Issue Type', 'Epic Link', 'Sprint', 'Assignee', 'Story Points'],
  smartsheet: ['Row ID', 'Modified', 'Duration', 'Predecessors', 'Assigned To'],
}

type AliasTable = Partial<Record<CanonicalField, string[]>>

const ADO_ALIASES: AliasTable = {
  title: ['Title'],
  status: ['State'],
  assignee: ['Assigned To'],
  epic: ['Epic'],
  area_path: ['Area Path'],
  iteration: ['Iteration Path'],
  tags: ['Tags'],
  due_date: ['Target Date', 'Due Date'],
  work_item_type: ['Work Item Type'],
  story_points: ['Story Points', 'Effort'],
}

const JIRA_ALIASES: AliasTable = {
  title: ['Summary'],
  status: ['Status'],
  assignee: ['Assignee'],
  epic: ['Epic Link', 'Epic Name'],
  iteration: ['Sprint'],
  tags: ['Labels', 'Components'],
  due_date: ['Due Date'],
  completed_date: ['Resolved'],
  work_item_type: ['Issue Type'],
  story_points: ['Story Points'],
}

const SMARTSHEET_ALIASES: AliasTable = {
  title: ['Task Name', 'Primary Column', 'Name'],
  status: ['Status'],
  assignee: ['Assigned To'],
  due_date: ['End', 'End Date', 'Finish'],
}

const GENERIC_ALIASES: AliasTable = {
  title: ['Title', 'Name', 'Summary', 'Task', 'Task Name', 'Item', 'Subject'],
  status: ['Status', 'State', 'Stage'],
  assignee: ['Assignee', 'Assigned To', 'Owner', 'Responsible', 'Resource'],
  epic: ['Epic', 'Epic Link', 'Epic Name', 'Parent'],
  area_path: ['Area Path', 'Area', 'Team'],
  iteration: ['Iteration', 'Iteration Path', 'Sprint'],
  tags: ['Tags', 'Labels', 'Components', 'Category'],
  due_date: ['Due', 'Due Date', 'End', 'End Date', 'Target Date', 'Finish'],
  completed_date: ['Completed', 'Completed Date', 'Resolved', 'Closed'],
  work_item_type: ['Type', 'Work Item Type', 'Issue Type'],
  story_points: ['Story Points', 'Points', 'Effort', 'Estimate'],
}

const ALIASES_BY_SOURCE: Record<SourceTool, AliasTable> = {
  ado: ADO_ALIASES,
  jira: JIRA_ALIASES,
  smartsheet: SMARTSHEET_ALIASES,
  unknown: GENERIC_ALIASES,
}

const REQUIRED_FIELDS: CanonicalField[] = ['title', 'status']

function norm(s: string): string {
  return s.trim().toLowerCase()
}

export function detectSchema(headers: string[]): DetectionResult {
  const trimmedHeaders = headers.map((h) => h.trim())
  const normalized = trimmedHeaders.map(norm)

  let best: { source: Exclude<SourceTool, 'unknown'>; matches: number } | null =
    null

  for (const key of Object.keys(SOURCE_SIGNATURES) as Array<
    Exclude<SourceTool, 'unknown'>
  >) {
    const signature = SOURCE_SIGNATURES[key]
    const matches = signature.filter((sig) =>
      normalized.includes(norm(sig)),
    ).length
    if (!best || matches > best.matches) best = { source: key, matches }
  }

  let source: SourceTool
  let confidence: number

  if (best && best.matches >= 2) {
    source = best.source
    const sigLen = SOURCE_SIGNATURES[best.source].length
    confidence = best.matches / sigLen
  } else {
    source = 'unknown'
    confidence = 0
  }

  const aliases = ALIASES_BY_SOURCE[source]
  const columnMap: ColumnMap = {}
  const claimed = new Set<string>()

  for (const field of Object.keys(aliases) as CanonicalField[]) {
    const candidates = aliases[field] ?? []
    for (const candidate of candidates) {
      const idx = normalized.indexOf(norm(candidate))
      if (idx >= 0) {
        const header = trimmedHeaders[idx]
        columnMap[field] = header
        claimed.add(norm(header))
        break
      }
    }
  }

  const unmappedHeaders = trimmedHeaders.filter(
    (h) => h.length > 0 && !claimed.has(norm(h)),
  )

  const missingRequired = REQUIRED_FIELDS.filter((f) => !columnMap[f])

  return {
    source,
    confidence,
    columnMap,
    unmappedHeaders,
    missingRequired,
  }
}
