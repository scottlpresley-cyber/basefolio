# Sprint 2 Security Audit

*Walkthrough of every API route against a 10-item checklist.
Performed as part of Sprint 2 Prompt 9. Not a pen test — a
checklist review to catch the categories of mistakes that show up
in SaaS breach postmortems.*

*Performed: 2026-04-19 against commit c1acfd2. F-1 resolved in commit 042a78d.*

## Checklist (applied to each route)

1. **Authentication** — route checks auth before any work.
   Unauthenticated → 401.
2. **Organization scoping** — `organization_id` derived from auth
   context, never from request body.
3. **RLS reliance** — data access goes through the user-scoped
   Supabase client (RLS enforced); service role only where
   explicitly needed (e.g. storage, public share reads).
4. **Input validation** — request body validated with a schema;
   untrusted fields rejected, not coerced.
5. **Output safety** — responses don't leak DB error text or
   internal details; generic 500 messages.
6. **File upload validation** — MIME/extension/size checked
   server-side (where applicable).
7. **Claude prompt boundedness** — inputs to Claude have enforced
   size limits (where applicable).
8. **Dangerous HTML** — no `dangerouslySetInnerHTML` with
   untrusted data.
9. **Error handling** — async paths wrapped in try/catch.
10. **CORS/CSP** — default same-origin; no overly-permissive CORS.

---

## /api/status-draft/upload (POST)

| # | Check | Status | Note |
|---|---|---|---|
| 1 | Authentication | PASS | `supabase.auth.getUser()` at line 25; 401 at line 28-31 |
| 2 | Org scoping | PASS | `organizationId` read from users-table profile lookup, not body. Used only in storage-key construction |
| 3 | RLS reliance | PASS | User-scoped client for profile lookup. Service-role client used ONLY for Supabase Storage upload to private bucket — documented behavior per architecture §10 |
| 4 | Input validation | PASS | FormData + file instance check; size cap enforced before any processing |
| 5 | Output safety | PASS | Errors return short user-facing messages; `console.error` stays server-side |
| 6 | File upload validation | **PASS** | Size capped at 10 MB. MIME allowlist added in commit 042a78d — `text/csv`, `application/csv`, `text/x-csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Rejects before `storage.upload`. Extension check retained in `parseFile` as defense-in-depth. |
| 7 | Claude prompt bounded | N/A | No Claude call |
| 8 | Dangerous HTML | N/A | No rendering |
| 9 | Error handling | PASS | Outer try/catch wraps the full handler body; `ParseError` special-cased |
| 10 | CORS/CSP | PASS | Default Next.js same-origin |

### F-1 (resolved) — MIME type was not validated server-side

An attacker could upload an arbitrary binary blob (say, `evil.csv`
that's actually an executable) and it would be staged to Supabase
Storage before `parseFile` rejects it. Mitigating factors made the
concrete risk low:

- The storage path is `${orgId}/${userId}/...` so cross-tenant
  reads are impossible.
- The bucket is private (service-role-only access) per architecture §10.
- `parseFile` rejects non-CSV/XLSX content before the file is read
  downstream.
- 24-hour TTL on the bucket cleans up staged files regardless.

**Resolved in commit 042a78d** — MIME allowlist added before
`storage.upload`. Rejects with 400 `UNSUPPORTED_FILE_TYPE` when the
uploaded file's `type` is outside the allowlist. Extension +
`parseFile` rejection retained as defense-in-depth since browsers
don't always set accurate MIME types. Unit tests cover both the
reject path (no storage call) and the accept path for `text/csv` +
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

---

## /api/status-draft/generate (POST)

| # | Check | Status | Note |
|---|---|---|---|
| 1 | Authentication | PASS | `supabase.auth.getUser()` + profile lookup; 401 on either failure |
| 2 | Org scoping | PASS | `organizationId` from profile; **additional defense:** `storageKey` must start with `${organizationId}/` (line 134-140) or 403 |
| 3 | RLS reliance | PASS | User client for all DB ops. Service-role client used ONLY for private-bucket storage download |
| 4 | Input validation | PASS | Zod schema with `.strict()` rejects extra keys; `uuid()` on reportId in import route |
| 5 | Output safety | PASS | Generic user-facing errors; `console.error` for diagnostics |
| 6 | File upload | N/A | Reads from storage, no upload |
| 7 | Claude prompt bounded | **PASS** (as of Prompt 9) | `MAX_ROWS_PER_UPLOAD` (5000) throws at parse; `MAX_PROJECTS_PER_REPORT` (100) rejects after grouping. Was FAIL pre-Prompt 9 |
| 8 | Dangerous HTML | N/A | Streams text/plain; no HTML rendering |
| 9 | Error handling | PASS | Outer try/catch; stream error/end handlers each wrap `controller.error`/`close` in their own try/catch |
| 10 | CORS/CSP | PASS | Default same-origin |

**Additional note:** The rate limiter added in Prompt 9
(`enforceRateLimit`) layers on top of these checks — 5
generations/user/hour caps both abuse and runaway loops in
legitimate clients.

---

## /api/status-draft/import (POST)

| # | Check | Status | Note |
|---|---|---|---|
| 1 | Authentication | PASS | `getAuthContext` at line 48; 401 at line 51-56 |
| 2 | Org scoping | PASS | `auth.orgId` passed to `bulkImportProjects`. Body only contains `reportId`; RLS on `status_reports` filters cross-org reads to null → 404 |
| 3 | RLS reliance | PASS | User client throughout; no service-role usage |
| 4 | Input validation | PASS | Zod with `reportId: z.string().uuid()` |
| 5 | Output safety | PASS | Specific codes (REPORT_NOT_FOUND, INVALID_REPORT, INTERNAL); no DB error leakage |
| 6 | File upload | N/A | No file upload |
| 7 | Claude prompt bounded | N/A | No Claude call |
| 8 | Dangerous HTML | N/A | JSON response |
| 9 | Error handling | PASS | Try/catch; `INTERNAL` 500 on unhandled |
| 10 | CORS/CSP | PASS | Default |

---

## /api/projects (POST)

| # | Check | Status | Note |
|---|---|---|---|
| 1 | Authentication | PASS | `getAuthContext` at line 33; 401 at line 34-39 |
| 2 | Org scoping | PASS | `auth.orgId` explicitly assigned in the insert payload (line 74); body fields spread is avoided — payload constructed field-by-field as documented at line 69-71 |
| 3 | RLS reliance | PASS | User client for plan count + insert. RLS WITH CHECK on projects is the backstop if the explicit org scoping were ever to drift |
| 4 | Input validation | PASS | `newProjectInputSchema` via zod; field-level errors returned |
| 5 | Output safety | PASS | 201/400/401/402/500 contract; generic INTERNAL_ERROR with detailed console.error |
| 6 | File upload | N/A | No file upload |
| 7 | Claude prompt bounded | N/A | No Claude call |
| 8 | Dangerous HTML | N/A | JSON |
| 9 | Error handling | PASS | Outer try/catch; PlanLimitError specifically caught and mapped to 402 |
| 10 | CORS/CSP | PASS | Default |

---

## /api/projects/[id] (PATCH)

| # | Check | Status | Note |
|---|---|---|---|
| 1 | Authentication | PASS | `getAuthContext` at line 46; 401 at line 47-52 |
| 2 | Org scoping | PASS | `getProject(supabase, id)` uses user client — RLS-hidden cross-org rows return null → 404. Schema `projectPatchSchema` does not include `organization_id` so the field is stripped during parse; handler also rebuilds the non-health patch field-by-field (line 106-115) |
| 3 | RLS reliance | PASS | User client throughout; `updateProjectHealth` + `updateProject` both inherit the user-scoped client |
| 4 | Input validation | PASS | Zod schema + defense-in-depth cross-date check that merges patch with existing project (line 78-96) |
| 5 | Output safety | PASS | 200/400/401/404/500 contract; generic INTERNAL_ERROR |
| 6 | File upload | N/A | No file upload |
| 7 | Claude prompt bounded | N/A | No Claude call |
| 8 | Dangerous HTML | N/A | JSON |
| 9 | Error handling | PASS | Outer try/catch |
| 10 | CORS/CSP | PASS | Default |

---

## /api/projects/[id]/updates (POST)

| # | Check | Status | Note |
|---|---|---|---|
| 1 | Authentication | PASS | `getAuthContext` at line 38; 401 at line 39-44 |
| 2 | Org scoping | PASS | `auth.orgId`, `auth.userId`, and the URL-path `projectId` all pinned server-side (line 73-75). Body does not define org/project/author fields in the schema, and the handler constructs the insert explicitly |
| 3 | RLS reliance | PASS | User client throughout. `getProject` pre-check returns 404 for cross-org projects before the insert is attempted |
| 4 | Input validation | PASS | `newProjectUpdateInputSchema` via zod |
| 5 | Output safety | PASS | 201/400/401/404/500 contract |
| 6 | File upload | N/A | No file upload |
| 7 | Claude prompt bounded | N/A | No Claude call (yet — when "Draft from notes" lands in Prompt 10, rate limiting will need to extend here) |
| 8 | Dangerous HTML | N/A | JSON response; client renders summary with `whitespace-pre-wrap` — plain text only |
| 9 | Error handling | PASS | Try/catch; generic INTERNAL_ERROR |
| 10 | CORS/CSP | PASS | Default |

---

## Summary

**6 routes audited. 0 FAIL. 0 PARTIAL.**

### Finding F-1 (resolved) — upload route MIME validation

- **Route:** `/api/status-draft/upload`
- **Check:** #6 File upload validation
- **Status:** PASS (was PARTIAL pre-resolution)
- **Resolved:** commit 042a78d — MIME allowlist check added before `storage.upload`. See route section above for the allowlist values and the defense-in-depth notes.

### Notable positives

- **Org scoping is defense-in-depth across the board.** Every mutation route both strips org fields at the schema layer AND explicitly constructs insert payloads field-by-field, backed by RLS `WITH CHECK` policies in the DB.
- **Secrecy posture on cross-tenant reads is consistent.** `/projects/[id]` GET, PATCH, and `/projects/[id]/updates` POST all collapse "doesn't exist" and "exists in another org" to 404 — no existence leak.
- **Service-role usage is narrow.** Only Supabase Storage (private bucket) and the public `/share/[token]` path use service role; everywhere else runs under RLS.
- **Prompt boundedness closed this sprint.** Pre-Prompt 9 `/status-draft/generate` would have accepted arbitrarily large prompts; `MAX_ROWS_PER_UPLOAD` + `MAX_PROJECTS_PER_REPORT` now cap both dimensions with explicit, actionable error messages.
