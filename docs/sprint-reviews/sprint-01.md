# Sprint 1 Review

**Closed: April 17, 2026**

## What shipped

Status Draft works end-to-end: upload a CSV or XLSX from ADO, Jira, or Smartsheet, correct the column mapping if auto-detection missed anything, watch a Claude-written narrative stream into the page in under 20 seconds, then one-click Import to Basefolio and land N project rows under the org. Every generated report persists to `status_reports` with the full parsed payload, so re-rendering and share-by-link are future freebies. Production builds now gate behind a preflight env check, so we can't ship half-configured.

## What cost more than expected

The claude.ts module-load env check. It threw at import time — fine in dev, but broke `next build` the moment a route imported it, because Next 16's page-data collection runs in isolated workers without `.env.local`. The fix was one line, but it cascaded into a preflight script so we don't ship broken deploys. The dedup constraint was the other one: shipped `UNIQUE(org, external_id)` without thinking about weekly re-imports, caught it only on a second run of the same CSV. Fix was two partial indexes; lesson was that "uniqueness" wanted a target use case before a schema line.

## What cost less than expected

Streaming worked on the first real Claude call: 2.4s first token, 17s to completion on a 17-row portfolio, rendered into the DOM exactly like the architecture doc said it should. No SSE wrestling, no backpressure surprises. Prompt v1 also held — the ado-realistic narrative names specific blockers and doesn't pad, so I froze it as a baseline without iteration.

## What carries into Sprint 2

The `idx_projects_org_report_external` helper is redundant now that the per-report unique index exists — a one-line drop migration. `/projects` is still a 404 stub, and the Import toast redirects there with nothing to land on. The narrative's "Next steps" lines lean passive-voice-by-committee ("Lucas and Maya should advance…") — worth a prompt tweak after beta. The ADO "Board Column vs State" ambiguity is untested; beta decides whether we map it or document the gotcha.

## What I'd do differently

Design the dedup schema before writing the import route, not during verification. One whiteboard sketch of "what does re-import week 2 look like" would have caught `UNIQUE(org, external_id)` as the wrong constraint before a line of it shipped.
