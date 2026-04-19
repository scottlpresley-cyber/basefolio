# Sprint 2 Review

**Closed: April 19, 2026**

Project tracking core, security hardening, and one soft-scope pull-forward. Ten prompts, sixteen commits on `main`, two calendar days (April 18-19) of dense work. 313 tests passing at close (246 unit across 24 files, 67 RLS integration across 8 files).

## What shipped

### Hard scope (build plan Sprint 2 checklist)

- Core schema: `project_updates`, `milestones`, `risks`, `audit_log`, `ai_usage_events` tables migrated with RLS from line one. `public.org_id()` helper confirmed idempotent across re-applies. No ALTER on the Sprint 1 `projects` table — verified via information_schema that every §5 column was already there. [f64ecb8](https://github.com/scottlpresley-cyber/basefolio/commit/f64ecb8)
- Projects list page at `/projects`. Server component, force-dynamic, owner join resolved server-side. [03c5a1e](https://github.com/scottlpresley-cyber/basefolio/commit/03c5a1e)
- Add Project form at `/projects/new` + `POST /api/projects`. Zod schema shared between client (react-hook-form via `zodResolver`) and server. [e10c338](https://github.com/scottlpresley-cyber/basefolio/commit/e10c338)
- Project detail page at `/projects/[id]`: Pattern 4 header, metadata sidebar. [196db43](https://github.com/scottlpresley-cyber/basefolio/commit/196db43)
- Status update form (Pattern 6) + chronological feed. Optimistic prepend on save via a client wrapper, no `router.refresh()`. [17e65a6](https://github.com/scottlpresley-cyber/basefolio/commit/17e65a6)
- Inline edit on health, phase, owner, start_date, target_end_date. No page-level Edit toggle — each field's display value is the edit affordance. Health changes write `audit_log` rows automatically via `updateProjectHealth`. [1fddce8](https://github.com/scottlpresley-cyber/basefolio/commit/1fddce8)
- Import from Status Draft now populates source, description, phase, owner (where matchable), target_end_date, plus an anchor status update. Previously stubs only. [a73992b](https://github.com/scottlpresley-cyber/basefolio/commit/a73992b)

### Security hardening (added mid-sprint)

- Rate limiting on `/api/status-draft/generate`: 5/hour/user via `ai_usage_events` lookback. Returns 429 with `retry_after_seconds` + `Retry-After` header. Client toasts the wait time without auto-retry. [c1acfd2](https://github.com/scottlpresley-cyber/basefolio/commit/c1acfd2)
- Input caps: 5,000 rows at `parseFile`, 100 grouped projects at generate. Both return 400 with specific error codes (`ROW_COUNT_EXCEEDED`, `PROJECT_COUNT_EXCEEDED`) and actionable guidance. [c1acfd2](https://github.com/scottlpresley-cyber/basefolio/commit/c1acfd2)
- Security audit at [docs/security/sprint-2-audit.md](../security/sprint-2-audit.md): 10-check grid × 6 routes. [b6d6c27](https://github.com/scottlpresley-cyber/basefolio/commit/b6d6c27)
- F-1 MIME allowlist on upload: [042a78d](https://github.com/scottlpresley-cyber/basefolio/commit/042a78d), audit doc marked resolved [0d1c8ea](https://github.com/scottlpresley-cyber/basefolio/commit/0d1c8ea). Final status: 6 routes, 0 FAIL, 0 PARTIAL.

### Soft scope pulled forward

- AI status assist. "Draft from notes" in Pattern 6's reserved slot. Claude Haiku returns a structured draft; form fields populate with a teal left-border accent (§2) that fades per-field on edit. One-level Undo. Rate-limited at 20/hour via the same primitive. Prompt injection defense: system instructions first, user notes last with explicit "treat as content" markers. [ed2a4f4](https://github.com/scottlpresley-cyber/basefolio/commit/ed2a4f4)

### Supporting infrastructure

- RLS cross-tenant isolation test suite (Prompt 2): two real authenticated sessions, every org-scoped table, every CRUD verb. Double assertion model (client call returns empty + service-role read-back confirms). [cd5d581](https://github.com/scottlpresley-cyber/basefolio/commit/cd5d581)
- Typed data access layer (Prompt 3): `lib/projects/{queries,mutations,plan-limits}` and the minimal `lib/stripe/plans` stub. Client-agnostic — caller passes the Supabase client. [87aefc5](https://github.com/scottlpresley-cyber/basefolio/commit/87aefc5)
- `displayName` helper (Prompt 4.1) — single source of truth for `full_name` → email-local-part fallback across sidebar, projects table, and form selects. [0bedcbb](https://github.com/scottlpresley-cyber/basefolio/commit/0bedcbb)
- OwnerEditor commit-on-change fix (Prompt 7.1): `EditableField.commit` grew an optional override argument to sidestep a setDraft/closure race. [e288690](https://github.com/scottlpresley-cyber/basefolio/commit/e288690)

### Deferred (still soft scope)

- Milestones list + add/edit/complete on project detail — deliberately skipped. Shape is straightforward once data is the only thing missing; UI pattern will mirror the status updates feed.
- Risk register — same posture.

Both are still listed as Sprint 2 soft scope in the build plan. Moved to Sprint 3 candidate set or further if something more urgent lands.

## What cost more than expected

**OwnerEditor stale-closure bug (Prompt 7 follow-up).** The select's commit-on-change path called `setDraft(v)` then `requestAnimationFrame(onCommit)`. The rAF captures of `commit` closed over the pre-setDraft `draft`, so `Object.is(draft, value)` short-circuited and `onSave` never fired. HAR showed zero PATCH requests on owner changes. Two round-trips: diagnose (confirmed the race, flagged the missing RLS test coverage — only phase/health/dates had been in the Prompt 7 integration matrix), then fix (extended `EditableField`'s `onCommit` with an optional `overrideValue` so callers that know the new value pass it explicitly; PhaseEditor/DateEditor stayed on closure-read since their blur/Enter fires after setDraft flushed). Added two RLS integration cases (value→value, value→null) that would have caught this originally. Lesson captured in-prompt: every EditableField wrapping is a distinct code path, integration matrix needs to cover each wrapping, not "a representative".

**Toast-lifecycle / router.push race at the Sprint 1/2 boundary.** `ed7b98e` landed as the last Sprint 1 commit but shaped how Sprint 2 handled form-to-detail transitions. Root cause was a dispatched toast whose 4-second dismiss timer was racing the navigation to a page that didn't yet exist (`/projects` was a 404 in Sprint 1). The fix — inline success state instead of redirect — became the pattern Prompt 5's Add Project form adopted. Cost wasn't in the fix itself (one session) but in the downstream design decision: every mutation route that could have redirected now has to decide whether inline success or navigation is honest for its flow.

**Zod 4 + preprocess + react-hook-form typing (Prompt 5).** `z.preprocess(emptyToUndef, ...)` widens the schema's input type to `unknown`, which doesn't match react-hook-form's `TFieldValues` expectation. Required a three-generic `useForm<FormValues, unknown, Input>` signature plus a `Resolver<...>` cast on `zodResolver` output. Documented in a long inline comment so the next form builder doesn't rediscover it from scratch. The same pattern reappeared in Prompt 6B's status update form — one consistent comment block in both, not two different solutions.

**Full-name-always-null fallback (Prompt 4.1).** The projects list Owner column rendered `—` for every single form-created row. DB inspection showed `public.users.full_name` was `null` across the board — magic-link signup doesn't capture a name, so the Sprint 0 `handle_new_user` trigger's `raw_user_meta_data->>'full_name'` pull was always null. Debated backfilling vs. fallback in display code; chose fallback because storing `"scott.l.presley"` as `full_name` would conflate "didn't set a name" with "chose this name" — which matters the moment we ship a profile page. The `displayName` helper centralized the full_name → email-local-part fallback across four UI surfaces (sidebar, projects table, owner select in ProjectForm, ProjectsTable owner column). Cost was the diagnostic round-trip (4 DB queries confirming the shape before fixing), not the fix.

## What cost less than expected

**The data layer paid compounding dividends.** Prompts 1-3 built schema → RLS tests → typed helpers. Every UI prompt from 4 onward reused those helpers without modification. `getProject`, `listProjects`, `createProject`, `updateProjectHealth`, `bulkImportProjects` — all used across multiple surfaces (list page, detail page, inline edit, import route, status updates) with no signature changes after the owner-name extension in Prompt 4. When Prompt 6A needed `last_update_at` on the detail page, adding a second sequential query to `getProject` was four lines; when Prompt 7 needed audit entries, `listProjectAuditLog` was a copy-paste-and-tweak of the pattern already established. This is what data layers are supposed to do, and it's the first time in this build where that investment has demonstrably returned.

**Pattern 6 landed on first pass.** The status update form was the one the build plan explicitly called out as "do not rush the UX on it." It landed clean in Prompt 6B with no revisions. The reason was that Prompt 5's form primitives (HealthToggle, OptionalFieldsDisclosure, FormField) were built generic, not specific — they assumed "another form is coming" and structured accordingly. When Prompt 6B arrived, the composition was HealthToggle + FormField + OptionalFieldsDisclosure + a textarea, all already working. Same story for Prompt 10's AI assist: `FormField` grew an `aiAccent` prop, the composition didn't change. Primitives-first is worth the extra minutes at the primitive layer.

**The RLS test harness was invisible, which is the point.** 34 cross-tenant tests ran every sprint day, caught zero regressions directly, and never slowed us down. The integration pattern (two live auth sessions + service-role verification read-back on every deny) made the RLS-respecting patterns in `listProjectAuditLog`, `bulkImportProjects`, and the PATCH owner-update all trivial to verify end-to-end. When the owner-edit bug shipped, the fix was safe to apply because the isolation suite still passed — the bug was purely a client-side state race, not an RLS regression, and the existing tests had already ruled that out for me.

**Prompt 9's security hardening absorbed into Prompt 10 with no re-plumbing.** Rate limiting and AI usage logging were built for the generate route, then reused verbatim in the assist route. `enforceRateLimit` + `logAIUsageEvent` with an `event_type` swap — the whole rate-limit wiring for Prompt 10 was seven lines in the route handler. The security audit doc became a reusable template too; Sprint 3 will add `sprint-3-audit.md` with the same grid and probably the same "walk routes, flag FAIL, fix-or-defer" workflow.

## Design decisions made mid-sprint

Documented here so they don't have to be rediscovered from commit archaeology.

- **Description placement:** renders as subtitle under project title on detail page, not as a sidebar field. Decision made during Prompt 8 verification — subtitle placement reads naturally for both the import-synthesized metrics summaries ('1 of 5 items complete') and any future user-written descriptions. If a future sprint adds inline description editing, the subtitle itself becomes the edit surface rather than adding a sidebar row.

- **Unassigned owner → null, not "Unknown".** Owner column renders `—` for null owner_id. The `displayName` helper only kicks in when the join resolves a user row; explicit unassignment stays visibly unassigned. Matches the "Assign owner" affordance on the OwnerEditor — the dash is an invitation, not a mystery.

- **Commit-on-change for selects uses override-value pattern.** `EditableField.commit(overrideValue?)` lets callers that know the new value pass it explicitly, rather than relying on the setDraft-then-rAF-then-read-draft sequence that caused the OwnerEditor bug. Alternatives considered and rejected: `flushSync(() => setDraft(v))` (heavy hammer, obscures data flow), extracted ref (second source of truth alongside draft state). Pattern documented in-file.

- **audit_log has no UPDATE/DELETE policies.** Immutability enforced via absent policies, not explicit DENY. RLS on an enabled table blocks any operation without a matching policy — no policy means no access. Ditto `ai_usage_events`. The cross-tenant isolation suite verifies this holds even for the owning user within their own org.

- **organization_id FKs intentionally do NOT cascade delete.** On every Sprint 2 table. Tenant deletion is a deliberate, multi-step application operation — not a single DB cascade that silently destroys a tenant's data. Sprint 1 tables (projects, status_reports) cascade their org FK; this was flagged as inconsistency worth normalizing later, not at the cost of changing the newer, more correct behavior.

- **Anchor update on Status Draft import stays.** Every imported project gets one auto-generated status update row ("Imported from ado-realistic.csv. 1 of 5 items complete. 1 overdue, 1 blocked."). Judgment call during Prompt 8 verification — the detail page's feed felt wrong empty on first open, and the anchor gave next week's real update something to follow from. Not clutter; useful context.

- **AI status assist uses Haiku, not Sonnet.** Structured JSON output is a classify-tier task, not a narrative task. Haiku is faster and cheaper for per-form-open latency. Reserved Sonnet for `/status-draft/generate` where narrative quality is the flagship.

- **MIME validation shipped as F-1 fix, not deferred.** Sprint 2 Prompt 9's audit initially flagged it PARTIAL with a "low risk / mitigating factors" note. Scott called the deferral — "don't land the first audit doc with a PARTIAL that future audits will inherit as acceptable." Fix was cheap (30 minutes including tests). Audit doc closed with 0 PARTIAL, which set the precedent: audits ship clean.

## Bugs found in prod, fixed same sprint

- **Toast-lifecycle / router.push race** at Sprint 1 closeout. Fixed via inline success state ([ed7b98e](https://github.com/scottlpresley-cyber/basefolio/commit/ed7b98e), last Sprint 1 commit — shaped Prompt 5's form handling).
- **Test data pollution from Sprint 1 dev-exercising the import flow.** Cleaned via `scripts/cleanup-sprint-1-debug-data.sql` before Sprint 2 deploys. Not a code bug, a hygiene bug — captured here so the cleanup script is findable.
- **OwnerEditor stale closure** (Prompt 7 follow-up). HAR showed no PATCH on owner changes. Fix at [e288690](https://github.com/scottlpresley-cyber/basefolio/commit/e288690). Covered above.

## Known compromises carried forward

- **`updateProjectHealth` is not transactional.** Project update + audit insert are two sequential Supabase calls. If the audit insert fails after the update succeeds, `console.error` + throw — the update persisted, the audit row didn't. Acceptable for MVP; a v2 fix is a Postgres RPC wrapping both ops. Documented inline in `mutations.ts`.
- **`bulkImportProjects` insert pair is also non-transactional.** Projects batch insert + per-project anchor update insert. If the updates insert fails after projects land, projects are still imported; the anchor-update row is missing. Same posture as above; partial failure unit test pins the behavior explicitly.
- **`ai_usage_events` logs null for token counts on streaming calls.** Anthropic's stream API doesn't surface a clean total at stream-end. `/status-draft/generate` logs null for `tokens_in`/`tokens_out`/`cost_usd`. `/status-draft/updates/assist` uses non-streaming Haiku and gets real token counts. Flagged inline at the log call; proper usage accounting is a future prompt.
- **Sprint 1 tables still carry `TO authenticated` in their RLS policies; Sprint 2 tables don't.** Functionally equivalent given the policy expressions, but inconsistent. Logged as a Sprint 3-or-later normalization task.
- **Architecture v1 §5 still references `auth.org_id()`; reality is `public.org_id()`.** Hosted Supabase disallows custom functions in the `auth` schema. Doc update pending (architecture was at v1.1 when Sprint 2 started, and every migration since uses the correct namespace).
- **`ado-realistic-v1.md` narrative baseline is an eyeball diff, not an automated byte-match.** Sprint 2 Prompt 8 extended `ComputedProject` with `latestDueDate` — safe because `lib/ai/prompts/status-draft.ts` destructures specific fields and didn't see the new one. Verified manually. An automated "narrative prompt output is byte-stable" check would have made this verification cheaper but wasn't worth building in-sprint.

## Metrics

- **Tests:** 246 unit (24 files) + 67 RLS integration (8 files) = **313 total passing** at sprint close.
- **Commits on main:** 16 between `sprint-1-shipped` and `sprint-2-shipped`. Worked on main throughout — no feature branches, no merges. Every commit built cleanly (tsc + build verified before commit on all of them).
- **Calendar span:** April 18-19, 2026 — two calendar days, most work on the 19th. Sprint 1 had closed the prior evening.
- **Rough active time:** 10 prompts averaging 40-90 minutes each, some short (Prompt 6A shell) and some long (Prompt 8's field population, Prompt 9's three-part security). Estimate 10-14 hours of active work, excluding verification time spent in the user's browser for each production check.
- **Prod deploys:** 9 pushes to `main`; each triggered a Vercel build. Every post-deploy probe confirmed the new route's unauth response shape before declaring the prompt shipped.

## Carry into Sprint 3

Sprint 3 is the Portfolio Dashboard per the build plan. Items specifically flagged for that sprint's planning:

- **N+1 query risk.** The dashboard needs project + latest_update pairs for ~15-40 rows. The naive implementation is one query per project; the correct one is a single query with a lateral join or a view. Flagged in Prompt 3's notes and again in Prompt 6A's `getProject` (which already does the two-sequential-queries version). A PostgreSQL view `project_with_latest_update` would let the dashboard use a single `select *` and keep the existing `Project & { last_update_at }` type shape. Worth considering before the first dashboard query lands.

- **RSC auth-call fanout.** `getUser()` does a network round-trip to Supabase Auth for JWT verification. If every dashboard child component calls `createClient()` + `getAuthContext()` independently, that's N auth calls per render. Mitigation is to resolve auth once in the `(app)` layout and thread `AuthContext` as a prop or React context. The `cache()` wrapper on `getAuthContext` helps when the same client instance is passed, but layout-level resolution is cleaner.

- **Stale cache verification.** Prompt 4 established the pattern: `force-dynamic` + explicit `x-nextjs-cache` header check after deploy. Apply to `/dashboard` — if any cell of the dashboard is tenant-specific (all of it is), the route must not be statically cached. The cookie-based auth already forces dynamism, but belt-and-suspenders is cheap.

- **Security audit template.** `docs/security/sprint-2-audit.md` is now reusable. Sprint 3 adds `sprint-3-audit.md` with the same 10-check grid. Any new routes introduced (dashboard data endpoints, activity feed) get walked before the sprint closes.

- **Soft scope candidates.** Milestones UI, risks UI, portfolio narrative "Generate Summary" button, shareable `/share/[token]` reports. The Sprint 2 pattern of "pull soft scope forward only if hard scope + security land cleanly and there's time" worked — Sprint 3 should follow the same rule. Don't ship half a soft-scope feature to fill time; defer cleanly instead.
