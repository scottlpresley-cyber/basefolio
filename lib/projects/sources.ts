// Maps the projects.source taxonomy (stored as 'ado'/'jira'/
// 'smartsheet'/'manual' per the Sprint 1 CHECK constraint) to user-
// facing labels. Callers should NEVER render the raw source string —
// it's a database code, not a display value.

const LABELS: Record<string, string> = {
  ado: 'Azure DevOps',
  jira: 'Jira',
  smartsheet: 'Smartsheet',
  manual: 'Created manually',
}

export function formatSource(source: string | null | undefined): string {
  if (!source) return '—'
  return LABELS[source] ?? '—'
}
