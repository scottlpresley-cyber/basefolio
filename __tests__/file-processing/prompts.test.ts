import { describe, it, expect } from 'vitest'
import {
  PORTFOLIO_ANALYST_SYSTEM,
  buildStatusDraftPrompt,
  formatProjectForPrompt,
} from '@/lib/ai/prompts/status-draft'
import type { ComputedProject } from '@/lib/file-processing/types'

function baseProject(overrides: Partial<ComputedProject> = {}): ComputedProject {
  return {
    name: 'Platform',
    groupingKey: 'area_path',
    itemCount: 4,
    statusCounts: {
      complete: 2,
      in_progress: 1,
      blocked: 0,
      not_started: 1,
      unknown: 0,
    },
    percentComplete: 50,
    overdueCount: 0,
    blockedCount: 0,
    health: 'green',
    inferredOwner: 'Alice',
    topItems: [
      { title: 'Ship ingestion v2', status: 'in_progress', assignee: 'Alice' },
      { title: 'Add retry logic', status: 'not_started', assignee: null },
      { title: 'Doc rollout', status: 'complete', assignee: 'Alice' },
    ],
    ...overrides,
  }
}

const META = {
  source: 'ado' as const,
  filename: 'q2.csv',
  asOfDate: '2026-04-17',
}

describe('buildStatusDraftPrompt', () => {
  it('includes each project name exactly once as a ## Project: header', () => {
    const projects: ComputedProject[] = [
      baseProject({ name: 'Platform' }),
      baseProject({ name: 'Mobile App' }),
    ]
    const prompt = buildStatusDraftPrompt(projects, META)
    const platformHits = prompt.match(/^## Project: Platform$/gm) ?? []
    const mobileHits = prompt.match(/^## Project: Mobile App$/gm) ?? []
    expect(platformHits).toHaveLength(1)
    expect(mobileHits).toHaveLength(1)
  })

  it('renders percent complete in each project block', () => {
    const projects: ComputedProject[] = [
      baseProject({ name: 'A', percentComplete: 75 }),
      baseProject({ name: 'B', percentComplete: 0 }),
    ]
    const prompt = buildStatusDraftPrompt(projects, META)
    expect(prompt).toContain('Percent complete: 75%')
    expect(prompt).toContain('Percent complete: 0%')
  })

  it('reports overdue count per project (including zero)', () => {
    const projects = [
      baseProject({ name: 'Clean', overdueCount: 0 }),
      baseProject({ name: 'Messy', overdueCount: 3 }),
    ]
    const prompt = buildStatusDraftPrompt(projects, META)
    expect(prompt).toMatch(/Project: Clean[\s\S]*Overdue items: 0/)
    expect(prompt).toMatch(/Project: Messy[\s\S]*Overdue items: 3/)
  })

  it('limits top items to 10 per project', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      title: `Task ${i + 1}`,
      status: 'in_progress' as const,
      assignee: null,
    }))
    const prompt = formatProjectForPrompt(
      baseProject({ topItems: many.slice(0, 10) }),
    )
    expect(prompt).toContain('Task 1')
    expect(prompt).toContain('Task 10')
    expect(prompt).not.toContain('Task 11')
  })

  it('marks unassigned top items with "unassigned"', () => {
    const block = formatProjectForPrompt(
      baseProject({
        topItems: [
          { title: 'Lonely task', status: 'blocked', assignee: null },
        ],
      }),
    )
    expect(block).toContain('- [blocked] Lonely task (unassigned)')
  })

  it('includes the verbatim output contract section', () => {
    const prompt = buildStatusDraftPrompt([baseProject()], META)
    expect(prompt).toContain('## Executive Summary')
    expect(prompt).toContain('## Project Status')
    expect(prompt).toContain('**Blockers/Risks:**')
    expect(prompt).toContain(
      'Use ONLY the data provided. Do not invent item names, assignees',
    )
    expect(prompt).toContain('Match the Project Name header exactly as given.')
  })

  it('passes special characters in project names through literally', () => {
    const projects = [
      baseProject({ name: 'Acme, Inc. "Roadmap"' }),
      baseProject({ name: "Bob's project / eng" }),
    ]
    const prompt = buildStatusDraftPrompt(projects, META)
    expect(prompt).toContain('## Project: Acme, Inc. "Roadmap"')
    expect(prompt).toContain("## Project: Bob's project / eng")
  })

  it('reports total work items across all projects in the header', () => {
    const projects = [
      baseProject({ itemCount: 7 }),
      baseProject({ name: 'Other', itemCount: 3 }),
    ]
    const prompt = buildStatusDraftPrompt(projects, META)
    expect(prompt).toContain('Portfolio contains 2 projects totaling 10 work items.')
  })

  it('renders the meta header line with source, filename, asOfDate', () => {
    const prompt = buildStatusDraftPrompt([baseProject()], META)
    expect(prompt).toContain(
      'Source: Azure DevOps · File: q2.csv · As of: 2026-04-17',
    )
  })
})

describe('PORTFOLIO_ANALYST_SYSTEM', () => {
  it('includes the core anti-patterns', () => {
    expect(PORTFOLIO_ANALYST_SYSTEM).toContain('exciting')
    expect(PORTFOLIO_ANALYST_SYSTEM).toContain('leveraging')
    expect(PORTFOLIO_ANALYST_SYSTEM).toContain("in today's fast-paced")
    expect(PORTFOLIO_ANALYST_SYSTEM).toContain('emoji')
    expect(PORTFOLIO_ANALYST_SYSTEM).toContain('exclamation')
  })
})
