import { ParseError, type ParseErrorCode } from './types'

interface ErrorResponse {
  status: number
  body: { error: string; code: ParseErrorCode }
}

const MESSAGES: Record<ParseErrorCode, { status: number; error: string }> = {
  EMPTY_FILE: {
    status: 400,
    error:
      'This file has headers but no data rows. Export at least one work item and try again.',
  },
  UNPARSEABLE: {
    status: 400,
    error:
      "We couldn't read that file. Save it as .csv or .xlsx and try again.",
  },
  NO_HEADERS: {
    status: 400,
    error:
      'The first row of your file needs to contain column names like Title, Status, Assigned To.',
  },
  UNSUPPORTED_FORMAT: {
    status: 400,
    error: 'Only .csv, .xls, and .xlsx files are supported.',
  },
  TOO_LARGE: {
    status: 413,
    error:
      'File is over 10 MB. Export a smaller slice or split it by team or quarter.',
  },
  NO_REQUIRED_FIELDS: {
    status: 400,
    error:
      "We couldn't find a title or status column in this file. Check your export and try again.",
  },
}

export function parseErrorToResponse(err: ParseError): ErrorResponse {
  const entry = MESSAGES[err.code]
  return {
    status: entry.status,
    body: { error: entry.error, code: err.code },
  }
}
