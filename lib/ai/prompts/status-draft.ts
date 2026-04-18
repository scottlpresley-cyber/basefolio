import type { ComputedProject, SourceTool } from '@/lib/file-processing/types'

const SOURCE_LABEL: Record<SourceTool, string> = {
  ado: 'Azure DevOps',
  jira: 'Jira',
  smartsheet: 'Smartsheet',
  unknown: 'Unknown source',
}

export const PORTFOLIO_ANALYST_SYSTEM = `You are a senior PMO analyst writing a Monday-morning portfolio status note for an executive audience. You write the way a human PMO lead writes: direct, specific, plain. You surface risks without softening them and name wins without inflating them.

Voice rules:
- No marketing language. Never say "exciting", "leveraging", "in today's fast-paced", "robust", "seamless", "cutting-edge".
- No emoji, no exclamation points, no rhetorical questions.
- No bullet-point soup. Use prose for narrative; reserve bullets for the Project Status blocks where the template calls for them.
- Do not restate numbers the reader can already see (project count, item count, the obvious percentage).
- No jargon or filler. If a sentence does not carry information, cut it.
- Write in the past/present tense a human would use in a status email. Do not hedge.`

export interface StatusDraftPromptMeta {
  source: SourceTool
  filename: string
  asOfDate: string
}

export function buildStatusDraftPrompt(
  projects: ComputedProject[],
  meta: StatusDraftPromptMeta,
): string {
  const sourceLabel = SOURCE_LABEL[meta.source]
  const totalItems = projects.reduce((sum, p) => sum + p.itemCount, 0)

  const header =
    `Source: ${sourceLabel} · File: ${meta.filename} · As of: ${meta.asOfDate}\n` +
    `Portfolio contains ${projects.length} ${projects.length === 1 ? 'project' : 'projects'} totaling ${totalItems} work items.`

  const projectBlocks = projects.map(formatProjectForPrompt).join('\n\n')

  const contract = `Write a portfolio status report in this exact structure:

## Executive Summary
[2-3 paragraphs. Lead with overall portfolio health in one sentence. Then key wins and key risks. Close with watch items for next week. Do not restate the project count or item count; the reader can see it.]

## Project Status

### <Project Name> — [GREEN | YELLOW | RED]
**Progress:** X of Y items complete (Z%)
**This period:** <1-2 sentences on concrete progress from the top items>
**Next steps:** <1 sentence on what should advance next, based on in_progress and not_started items>
**Blockers/Risks:** <only include this line if the project has blocked or overdue items — omit entirely if clean. Be specific about WHAT is blocked or overdue, not just that something is.>

[repeat for each project, in the order provided above]

Rules:
  - Use ONLY the data provided. Do not invent item names, assignees, dates, or progress that isn't in the data.
  - If an item's title is vague, describe it vaguely — don't speculate about what it means.
  - Match the Project Name header exactly as given.
  - Do not add a separate "Recommendations" section. Watch items in the Executive Summary are sufficient.`

  return `${header}\n\n${projectBlocks}\n\n${contract}`
}

export function formatProjectForPrompt(project: ComputedProject): string {
  const {
    name,
    groupingKey,
    health,
    itemCount,
    statusCounts,
    percentComplete,
    overdueCount,
    inferredOwner,
    topItems,
  } = project

  const ownerLine = inferredOwner ?? 'none'

  const itemsLine =
    `    complete: ${statusCounts.complete} / in_progress: ${statusCounts.in_progress} / ` +
    `blocked: ${statusCounts.blocked} / not_started: ${statusCounts.not_started} / unknown: ${statusCounts.unknown}`

  const top = topItems.slice(0, 10)
  const topLines =
    top.length === 0
      ? '    (no items)'
      : top
          .map((item) => {
            const who = item.assignee ?? 'unassigned'
            return `    - [${item.status}] ${item.title} (${who})`
          })
          .join('\n')

  return [
    `## Project: ${name}`,
    `  Grouping: ${groupingKey}`,
    `  Health: ${health}`,
    `  Items: ${itemCount} total`,
    itemsLine,
    `  Percent complete: ${percentComplete}%`,
    `  Overdue items: ${overdueCount}`,
    `  Inferred owner: ${ownerLine}`,
    `  Top items (up to 10):`,
    topLines,
  ].join('\n')
}
