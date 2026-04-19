// Pure synthesizer: ComputedProject + report-level metadata -> the
// fields we want to populate on the imported project row AND the
// anchor status_update we seed alongside it. Kept free of
// Supabase / auth / HTTP so unit tests can exercise the shape
// without fixtures.

import type { ComputedProject, SourceTool } from './types'

export type BuildProjectPayloadInput = {
  project: ComputedProject
  source: SourceTool
  sourceFileName: string | null
}

export type ImportPayload = {
  project: {
    name: string
    description: string | null
    phase: string | null
    health: 'green' | 'yellow' | 'red'
    status: 'active'
    source: 'ado' | 'jira' | 'smartsheet' | 'manual'
    external_id: string
    target_end_date: string | null
    // Owner is a string signal (email or name) — bulkImportProjects
    // resolves it to a users.id by matching against org members.
    inferredOwnerSignal: string | null
  }
  initialUpdate: {
    health: 'green' | 'yellow' | 'red'
    summary: string
  }
}

// 'unknown' detected sources land as 'manual' in the DB — there's no
// 'unknown' value in the projects.source CHECK constraint.
function normalizeSource(
  source: SourceTool,
): 'ado' | 'jira' | 'smartsheet' | 'manual' {
  if (source === 'ado' || source === 'jira' || source === 'smartsheet') {
    return source
  }
  return 'manual'
}

// Progress-based phase heuristic. Only fires when no explicit project-
// level phase signal exists (ADO / Jira / Smartsheet exports today
// don't expose one — the "State" column is item-level). Documented so
// future data that does expose a signal can replace this with a lookup.
function inferPhase(p: ComputedProject): string | null {
  if (p.itemCount === 0) return null
  if (p.percentComplete >= 80) return 'Closing'
  if (p.percentComplete > 0) return 'Execution'
  return 'Planning'
}

// 1-2 sentence metrics summary — renders as the "at a glance"
// description on /projects and the opening line of the anchor update
// on the detail page's feed. Kept under 200 chars so the list view
// doesn't wrap awkwardly.
function metricsSentence(p: ComputedProject): string {
  const { itemCount, statusCounts, overdueCount, blockedCount } = p
  const complete = statusCounts.complete
  const parts: string[] = [`${complete} of ${itemCount} items complete.`]
  const tail: string[] = []
  if (overdueCount > 0) {
    tail.push(`${overdueCount} overdue`)
  }
  if (blockedCount > 0) {
    tail.push(`${blockedCount} blocked`)
  }
  if (tail.length > 0) parts.push(`${tail.join(', ')}.`)
  return parts.join(' ')
}

function importSummary(
  p: ComputedProject,
  sourceFileName: string | null,
): string {
  const tag = sourceFileName
    ? `Imported from ${sourceFileName}.`
    : 'Imported from Status Draft.'
  return `${tag} ${metricsSentence(p)}`
}

export function buildProjectPayload({
  project,
  source,
  sourceFileName,
}: BuildProjectPayloadInput): ImportPayload {
  const normalizedSource = normalizeSource(source)
  const description = metricsSentence(project)
  // Belt-and-suspenders: cap at 200 chars even though the template
  // produces ~50-80. Prevents a future template tweak from silently
  // blowing the column width in the list view.
  const trimmedDescription =
    description.length > 200 ? `${description.slice(0, 197)}...` : description

  return {
    project: {
      name: project.name,
      description: trimmedDescription,
      phase: inferPhase(project),
      health: project.health,
      status: 'active',
      source: normalizedSource,
      external_id: project.name,
      target_end_date: project.latestDueDate ?? null,
      inferredOwnerSignal: project.inferredOwner,
    },
    initialUpdate: {
      health: project.health,
      summary: importSummary(project, sourceFileName),
    },
  }
}
