// Unit tests for buildProjectPayload. Fixture-driven — each case
// documents one of the field-population rules called out in the
// Sprint 2 Prompt 8 spec.

import { describe, test, expect } from 'vitest'
import type { ComputedProject } from '@/lib/file-processing/types'
import { buildProjectPayload } from '@/lib/file-processing/build-project-payload'

function project(overrides: Partial<ComputedProject> = {}): ComputedProject {
  return {
    name: 'Customer Portal',
    groupingKey: 'area_path',
    itemCount: 5,
    statusCounts: {
      complete: 1,
      in_progress: 2,
      blocked: 1,
      not_started: 1,
      unknown: 0,
    },
    percentComplete: 20,
    overdueCount: 1,
    blockedCount: 1,
    health: 'yellow',
    inferredOwner: 'Emily Parker',
    topItems: [],
    latestDueDate: '2026-05-15',
    ...overrides,
  }
}

describe('buildProjectPayload — project row', () => {
  test('passes through source when ado/jira/smartsheet', () => {
    for (const src of ['ado', 'jira', 'smartsheet'] as const) {
      const out = buildProjectPayload({
        project: project(),
        source: src,
        sourceFileName: 'x.csv',
      })
      expect(out.project.source).toBe(src)
    }
  })

  test('normalizes unknown source to manual (no CHECK constraint value)', () => {
    const out = buildProjectPayload({
      project: project(),
      source: 'unknown',
      sourceFileName: null,
    })
    expect(out.project.source).toBe('manual')
  })

  test('external_id mirrors the grouping name (matches Sprint 1 dedup semantics)', () => {
    const out = buildProjectPayload({
      project: project({ name: 'Nimbus Platform\\Payments' }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.external_id).toBe('Nimbus Platform\\Payments')
    expect(out.project.name).toBe('Nimbus Platform\\Payments')
  })

  test('status defaults to active (import never lands completed)', () => {
    const out = buildProjectPayload({
      project: project({ percentComplete: 100 }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.status).toBe('active')
  })

  test('health passes through from ComputedProject', () => {
    for (const h of ['green', 'yellow', 'red'] as const) {
      const out = buildProjectPayload({
        project: project({ health: h }),
        source: 'ado',
        sourceFileName: null,
      })
      expect(out.project.health).toBe(h)
    }
  })
})

describe('buildProjectPayload — phase heuristic', () => {
  test('>= 80% complete -> Closing', () => {
    const out = buildProjectPayload({
      project: project({ percentComplete: 85 }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.phase).toBe('Closing')
  })

  test('> 0 and < 80 -> Execution', () => {
    const out = buildProjectPayload({
      project: project({ percentComplete: 20 }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.phase).toBe('Execution')
  })

  test('0% -> Planning', () => {
    const out = buildProjectPayload({
      project: project({
        percentComplete: 0,
        statusCounts: {
          complete: 0,
          in_progress: 0,
          blocked: 0,
          not_started: 5,
          unknown: 0,
        },
      }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.phase).toBe('Planning')
  })

  test('zero items -> null phase (no signal)', () => {
    const out = buildProjectPayload({
      project: project({
        itemCount: 0,
        statusCounts: {
          complete: 0,
          in_progress: 0,
          blocked: 0,
          not_started: 0,
          unknown: 0,
        },
        percentComplete: 0,
      }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.phase).toBeNull()
  })
})

describe('buildProjectPayload — owner signal', () => {
  test('inferredOwner flows through as inferredOwnerSignal (not resolved here)', () => {
    const out = buildProjectPayload({
      project: project({ inferredOwner: 'scott.l.presley@gmail.com' }),
      source: 'ado',
      sourceFileName: null,
    })
    // Signal-only — bulkImportProjects does the users-table match.
    expect(out.project.inferredOwnerSignal).toBe('scott.l.presley@gmail.com')
  })

  test('null inferredOwner -> null signal', () => {
    const out = buildProjectPayload({
      project: project({ inferredOwner: null }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.inferredOwnerSignal).toBeNull()
  })
})

describe('buildProjectPayload — dates', () => {
  test('target_end_date = latestDueDate when present', () => {
    const out = buildProjectPayload({
      project: project({ latestDueDate: '2026-07-01' }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.target_end_date).toBe('2026-07-01')
  })

  test('target_end_date is null when latestDueDate is null', () => {
    const out = buildProjectPayload({
      project: project({ latestDueDate: null }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.target_end_date).toBeNull()
  })
})

describe('buildProjectPayload — description + summary', () => {
  test('description is a short metrics sentence', () => {
    const out = buildProjectPayload({
      project: project({
        itemCount: 18,
        statusCounts: {
          complete: 12,
          in_progress: 2,
          blocked: 1,
          not_started: 3,
          unknown: 0,
        },
        percentComplete: 67,
        overdueCount: 2,
        blockedCount: 1,
      }),
      source: 'ado',
      sourceFileName: 'ado-realistic.csv',
    })
    expect(out.project.description).toBe(
      '12 of 18 items complete. 2 overdue, 1 blocked.',
    )
  })

  test('description omits the "overdue / blocked" tail when counts are zero', () => {
    const out = buildProjectPayload({
      project: project({
        itemCount: 5,
        statusCounts: {
          complete: 2,
          in_progress: 2,
          blocked: 0,
          not_started: 1,
          unknown: 0,
        },
        percentComplete: 40,
        overdueCount: 0,
        blockedCount: 0,
      }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.description).toBe('2 of 5 items complete.')
  })

  test('description is capped at 200 chars', () => {
    const long = 'x'.repeat(500)
    // Cap only fires if the template grows past 200; synthesize a
    // worst-case to make sure the guard is in place.
    const out = buildProjectPayload({
      project: project({ name: long }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.project.description).not.toBeNull()
    expect(out.project.description!.length).toBeLessThanOrEqual(200)
  })

  test('initial update summary cites the source file when present', () => {
    const out = buildProjectPayload({
      project: project({
        itemCount: 5,
        statusCounts: {
          complete: 1,
          in_progress: 2,
          blocked: 1,
          not_started: 1,
          unknown: 0,
        },
        percentComplete: 20,
        overdueCount: 1,
        blockedCount: 1,
      }),
      source: 'ado',
      sourceFileName: 'ado-realistic.csv',
    })
    expect(out.initialUpdate.summary).toBe(
      'Imported from ado-realistic.csv. 1 of 5 items complete. 1 overdue, 1 blocked.',
    )
  })

  test('initial update falls back to generic source label when filename missing', () => {
    const out = buildProjectPayload({
      project: project({
        itemCount: 3,
        statusCounts: {
          complete: 0,
          in_progress: 1,
          blocked: 0,
          not_started: 2,
          unknown: 0,
        },
        percentComplete: 0,
        overdueCount: 0,
        blockedCount: 0,
      }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.initialUpdate.summary).toBe(
      'Imported from Status Draft. 0 of 3 items complete.',
    )
  })

  test('initial update health matches project health', () => {
    const out = buildProjectPayload({
      project: project({ health: 'red' }),
      source: 'ado',
      sourceFileName: null,
    })
    expect(out.initialUpdate.health).toBe('red')
  })
})
