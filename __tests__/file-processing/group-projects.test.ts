import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from '../../lib/file-processing/parse'
import { detectSchema } from '../../lib/file-processing/detect-schema'
import { groupProjects } from '../../lib/file-processing/group-projects'

const FIXTURES = join(__dirname, 'fixtures')

function loadAndDetect(name: string) {
  const { headers, rows } = parseFile(
    readFileSync(join(FIXTURES, name)),
    name,
  )
  const det = detectSchema(headers)
  return { rows, columnMap: det.columnMap }
}

describe('groupProjects', () => {
  it('groups ADO rows by area_path', () => {
    const { rows, columnMap } = loadAndDetect('ado-sample.csv')
    const groups = groupProjects(rows, columnMap)
    const distinct = new Set(rows.map((r) => r['Area Path']))
    expect(groups).toHaveLength(distinct.size)
    expect(groups.every((g) => g.groupingKey === 'area_path')).toBe(true)
  })

  it('groups Jira rows by epic when area_path is absent', () => {
    const { rows, columnMap } = loadAndDetect('jira-sample.csv')
    const groups = groupProjects(rows, columnMap)
    expect(groups.every((g) => g.groupingKey === 'epic')).toBe(true)
    const names = groups.map((g) => g.name).sort()
    expect(names).toEqual(['AUTH-12', 'BILLING-2', 'METRICS-7', 'ONB-3'])
  })

  it('returns a single Ungrouped project when no grouping fields are mapped', () => {
    const { rows } = loadAndDetect('unknown-sample.csv')
    const groups = groupProjects(rows, { title: 'Task', status: 'State' })
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Ungrouped')
    expect(groups[0].groupingKey).toBe('ungrouped')
    expect(groups[0].rows).toHaveLength(rows.length)
  })

  it('sorts groups largest-first', () => {
    const { rows, columnMap } = loadAndDetect('ado-sample.csv')
    const groups = groupProjects(rows, columnMap)
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].rows.length).toBeGreaterThanOrEqual(
        groups[i].rows.length,
      )
    }
  })
})
