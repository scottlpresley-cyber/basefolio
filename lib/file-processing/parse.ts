import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { ParseError, type ParsedRow } from './types'

export interface ParseResult {
  headers: string[]
  rows: ParsedRow[]
}

export function parseFile(buffer: Buffer, filename: string): ParseResult {
  const ext = getExtension(filename)

  if (ext === 'csv') return parseCsv(buffer)
  if (ext === 'xlsx' || ext === 'xls') return parseXlsx(buffer)
  throw new ParseError('UNSUPPORTED_FORMAT', `Unsupported file extension: .${ext}`)
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return ''
  return filename.slice(dot + 1).toLowerCase()
}

function parseCsv(buffer: Buffer): ParseResult {
  const text = buffer.toString('utf8')
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new ParseError('UNPARSEABLE', result.errors[0].message)
  }

  const rawHeaders = result.meta.fields ?? []
  validateHeaders(rawHeaders)

  const headers = rawHeaders.map((h) => h.trim())
  const rows: ParsedRow[] = result.data.map((row) => {
    const out: ParsedRow = {}
    for (const h of headers) {
      const v = row[h]
      out[h] = v === undefined || v === '' ? null : v
    }
    return out
  })

  if (rows.length === 0) {
    throw new ParseError('EMPTY_FILE', 'CSV has headers but no data rows')
  }

  return { headers, rows }
}

function parseXlsx(buffer: Buffer): ParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' })
  } catch (err) {
    throw new ParseError('UNPARSEABLE', (err as Error).message)
  }

  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new ParseError('EMPTY_FILE', 'Workbook has no sheets')
  }

  const sheet = workbook.Sheets[firstSheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  })

  if (matrix.length === 0) {
    throw new ParseError('EMPTY_FILE', 'Sheet is empty')
  }

  const headerRow = matrix[0]
  const rawHeaders = headerRow.map((cell) =>
    cell === null || cell === undefined ? '' : String(cell).trim(),
  )
  validateHeaders(rawHeaders)

  const headers = rawHeaders.map((h) => h.trim())
  const dataRows = matrix.slice(1)
  const rows: ParsedRow[] = dataRows.map((row) => {
    const out: ParsedRow = {}
    headers.forEach((h, i) => {
      const cell = row[i]
      if (cell === undefined || cell === null || cell === '') {
        out[h] = null
      } else if (typeof cell === 'number') {
        out[h] = cell
      } else {
        out[h] = String(cell)
      }
    })
    return out
  })

  if (rows.length === 0) {
    throw new ParseError('EMPTY_FILE', 'Sheet has headers but no data rows')
  }

  return { headers, rows }
}

function validateHeaders(headers: string[]): void {
  if (headers.length === 0) {
    throw new ParseError('NO_HEADERS', 'No header row found')
  }
  const anyNonEmpty = headers.some((h) => h.trim().length > 0)
  if (!anyNonEmpty) {
    throw new ParseError('NO_HEADERS', 'Header row is blank')
  }
  const firstNonEmpty = headers.findIndex((h) => h.trim().length > 0)
  if (firstNonEmpty !== 0) {
    throw new ParseError('NO_HEADERS', 'First header cell is blank')
  }
}
