import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../../lib/file-processing/parse'
import { detectSchema } from '../../lib/file-processing/detect-schema'
import { groupProjects } from '../../lib/file-processing/group-projects'
import {
  computeProjectMetrics,
  normalizeStatus,
} from '../../lib/file-processing/compute-metrics'
import type { ColumnMap, ParsedRow } from '../../lib/file-processing/types'

const FIXTURES = join(__dirname, 'fixtures')

function loadAndDetect(name: string) {
  const { headers, rows } = parseFile(
    readFileSync(join(FIXTURES, name)),
    name,
  )
  return { rows, columnMap: detectSchema(headers).columnMap }
}

describe('normalizeStatus', () => {
  it('buckets common status strings', () => {
    expect(normalizeStatus('Done')).toBe('complete')
    expect(normalizeStatus('In Progress')).toBe('in_progress')
    expect(normalizeStatus('Blocked')).toBe('blocked')
    expect(normalizeStatus('To Do')).toBe('not_started')
    expect(normalizeStatus('Something Weird')).toBe('unknown')
    expect(normalizeStatus(null)).toBe('unknown')
    expect(normalizeStatus('')).toBe('unknown')
  })
})

describe('computeProjectMetrics', () => {
  it('rates a 2-of-4-blocked ADO project as red', () => {
    const { rows, columnMap } = loadAndDetect('ado-sample.csv')
    const groups = groupProjects(rows, columnMap)
    const infra = groups.find((g) => g.name === 'Platform\\Infra')
    expect(infra, 'Platform\\Infra group missing').toBeDefined()
    const metrics = computeProjectMetrics(
      infra!.name,
      infra!.groupingKey,
      infra!.rows,
      columnMap,
    )
    expect(metrics.itemCount).toBe(4)
    expect(metrics.blockedCount).toBe(2)
    expect(metrics.health).toBe('red')
  })

  it('rates an all-Done Jira epic as green with 100% complete', () => {
    const { rows, columnMap } = loadAndDetect('jira-sample.csv')
    const groups = groupProjects(rows, columnMap)
    const onb = groups.find((g) => g.name === 'ONB-3')
    expect(onb).toBeDefined()
    const metrics = computeProjectMetrics(
      onb!.name,
      onb!.groupingKey,
      onb!.rows,
      columnMap,
    )
    expect(metrics.health).toBe('green')
    expect(metrics.percentComplete).toBe(100)
    expect(metrics.statusCounts.complete).toBe(onb!.rows.length)
  })

  it('stays green when exactly 10% overdue (threshold is strict >)', () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10)
    const rows: ParsedRow[] = []
    rows.push({ Title: 'late', Status: 'In Progress', Due: yesterday })
    for (let i = 0; i < 9; i++) {
      rows.push({ Title: `ok-${i}`, Status: 'In Progress', Due: '2027-01-01' })
    }
    const columnMap: ColumnMap = {
      title: 'Title',
      status: 'Status',
      due_date: 'Due',
    }
    const m = computeProjectMetrics('Mixed', 'ungrouped', rows, columnMap)
    expect(m.overdueCount).toBe(1)
    expect(m.blockedCount).toBe(0)
    expect(m.health).toBe('green')
  })

  it('picks the modal assignee as inferredOwner', () => {
    const rows: ParsedRow[] = [
      { Title: 'a', Status: 'Done', Who: 'Alice' },
      { Title: 'b', Status: 'Done', Who: 'Alice' },
      { Title: 'c', Status: 'Done', Who: 'Alice' },
      { Title: 'd', Status: 'Done', Who: 'Bob' },
    ]
    const m = computeProjectMetrics('P', 'ungrouped', rows, {
      title: 'Title',
      status: 'Status',
      assignee: 'Who',
    })
    expect(m.inferredOwner).toBe('Alice')
  })

  it('prioritizes blocked items first in topItems', () => {
    const rows: ParsedRow[] = []
    for (let i = 0; i < 5; i++) {
      rows.push({ Title: `blk-${i}`, Status: 'Blocked' })
    }
    for (let i = 0; i < 3; i++) {
      rows.push({ Title: `prog-${i}`, Status: 'In Progress' })
    }
    for (let i = 0; i < 2; i++) {
      rows.push({ Title: `done-${i}`, Status: 'Done' })
    }
    const m = computeProjectMetrics('P', 'ungrouped', rows, {
      title: 'Title',
      status: 'Status',
    })
    expect(m.topItems).toHaveLength(10)
    for (let i = 0; i < 5; i++) {
      expect(m.topItems[i].status).toBe('blocked')
    }
  })
})
