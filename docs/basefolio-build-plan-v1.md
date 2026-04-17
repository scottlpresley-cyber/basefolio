# Basefolio — Build Plan v1.0

*Solo build. 10–15 hours/week. Two-week sprints = 20–30 hours real work.*
*Last updated: April 15, 2026*

---

## How to Read This Plan

Each sprint has a **hard scope** (must ship to close the sprint) and a **soft scope** (do it if time allows, defer if not — never block the next sprint for it). Hours are honest estimates for AI-assisted development with Cursor/Claude Code. They will be wrong. The value is in relative sizing, not precision.

**Definition of "shipped":** Feature works end-to-end in production (Vercel + Supabase). Not localhost. Not "mostly done."

---

## Phase Overview

| Phase | Sprints | What You Can Demo | Launch Gate |
|---|---|---|---|
| 0 — Foundation | Sprint 0 | Auth flow, empty dashboard | No |
| 1 — The Flagship | Sprint 1 | Status Draft: upload → report | **Beta demo gate** |
| 2 — Core Governance | Sprints 2–3 | Full project tracking + updates | No |
| 3 — Dashboard & Reporting | Sprint 4 | Portfolio dashboard, shared reports | No |
| 4 — Monetization | Sprint 5 | Stripe checkout, plan limits enforced | **Launch gate** |
| 5 — Post-Launch | Sprints 6–7 | Intake queue, scoring | No |

**Target timeline:** Sprints 0–5 = ~14 weeks from start = early August 2026 launch.

---

## Why Status Draft Comes First

The instinct is to build the data model and CRUD layer first, then the flagship feature. Resist it.

Status Draft is the activation hook. It delivers real value to a user who has zero data in Basefolio — they just upload a file from whatever tool they're already using. That means you can demo it to beta prospects after Sprint 1, before the rest of the app exists. It also stress-tests the hardest technical path (file processing + Claude streaming) early, when it's cheapest to get wrong.

The "import to Basefolio" action at the end of Status Draft is what connects Phase 1 to Phase 2. A user runs their first draft, sees value, and clicks import. That's the onboarding moment. Build the thing that creates it first.

---

## Sprint 0 — Foundation
**Duration:** 1 week (~12 hours)
**Goal:** Empty app deployed to production. Auth works. Nothing breaks.

### Hard scope
- [ ] GitHub repo initialized, Next.js 14 App Router scaffolded
- [ ] Tailwind + shadcn/ui configured with `tailwind.config.ts` token set
- [ ] Supabase project created (US East), `.env.local` wired
- [ ] Vercel project connected to repo, auto-deploy on main branch confirmed
- [ ] Supabase Auth: magic link signup/login working end-to-end
- [ ] Organization provisioning: signup → org created → user row created → role=owner
- [ ] Auth middleware: `/app/*` routes redirect to `/login` if no session
- [ ] Sidebar layout shell: nav renders, links exist (pages are empty)
- [ ] First migration committed to `/supabase/migrations/`

### Soft scope
- [ ] Basic page titles and `<head>` metadata

### Definition of done
A new user can sign up via magic link, land on an empty `/dashboard`, and the sidebar renders. Deploying to Vercel from a push to main takes under 3 minutes.

### Watch out for
Supabase Auth + Next.js App Router middleware has a known gotcha with cookie handling. Use the `@supabase/ssr` package, not the legacy `@supabase/auth-helpers-nextjs`. The official Supabase docs for App Router are correct; older Stack Overflow answers are not.

---

## Sprint 1 — Status Draft (The Flagship)
**Duration:** 2 weeks (~25–30 hours)
**Goal:** A user can upload a CSV or XLSX and receive a polished, AI-generated portfolio status report.

### Hard scope
- [ ] `status_reports` table migrated and RLS policies in place
- [ ] File upload UI: drag-and-drop zone, file type/size validation, clear error states
- [ ] `POST /api/status-draft/upload`: receive file → parse in memory → return row preview + inferred column map
- [ ] Column mapping UI: show inferred map, let user correct before proceeding
- [ ] Source detection: ADO / Jira / Smartsheet / unknown — show detected source in UI
- [ ] Project grouping logic: rows → project objects with per-project metrics
- [ ] `POST /api/status-draft/generate`: compute metrics → stream Claude narrative
- [ ] Streaming render: report appears word-by-word, not after a full wait
- [ ] Report output: executive summary + per-project sections render correctly
- [ ] Actions: "Copy to clipboard" and "Download" (plaintext/markdown is fine for MVP — PDF/DOCX is v1.1)
- [ ] "Import to Basefolio" button: creates stub project records (name + health only) from report data
- [ ] Error handling: bad file format, unparseable columns, Claude API failure — all handled gracefully with actionable messages
- [ ] Report saved to `status_reports` table on generation

### Soft scope
- [ ] Confidence score display on column mapping ("We're 94% confident about these mappings")
- [ ] Report history page (`/reports`) listing past Status Drafts

### Definition of done
A user uploads a real ADO or Jira export, the column map is inferred correctly, and a formatted status report streams to screen within 30 seconds. The report reads like a PMO analyst wrote it, not like a language model summarized a spreadsheet.

### Watch out for
- **Vercel function timeout:** Default is 10 seconds on hobby plan, 60 seconds on Pro. Streaming responses keep the connection alive past the timeout, but you need to confirm this works in production, not just localhost. Switch to Vercel Pro before this sprint or test the timeout behavior explicitly.
- **SheetJS memory:** Large XLSX files (10MB+) can spike memory in a serverless function. Parse in streaming mode if files are consistently large.
- **Claude prompt iteration:** Budget 3–4 hours specifically for prompt tuning. The first draft output will be too verbose. You'll need at least two revision cycles to get the tone right.

---

## Sprint 2 — Project Tracking Core
**Duration:** 2 weeks (~25 hours)
**Goal:** Projects imported from Status Draft (or created manually) can be fully tracked.

### Hard scope
- [ ] `projects`, `project_updates`, `milestones`, `risks` tables migrated + RLS
- [ ] Projects list page (`/projects`): table view with health badge, owner, due date, phase
- [ ] Add project form: name, description, health, phase, owner, dates — minimal, not exhaustive
- [ ] Project detail page (`/projects/[id]`): header with health pill, metadata sidebar, updates feed
- [ ] Status update form (Pattern 6 from ui-context.md): health toggle + summary + optional fields
- [ ] Status update feed: chronological list of past updates on project detail
- [ ] Edit project: inline edit for health, phase, owner, dates
- [ ] Project health change logged to `audit_log`
- [ ] "Import from Status Draft" properly populates project records (not just stubs — full fields where available)

### Soft scope
- [ ] Milestones list on project detail (add/edit/complete)
- [ ] Risk register on project detail (add/edit/status change)
- [ ] AI status update assist: "Draft from notes" button calls Claude with free-text → generates structured summary

### Definition of done
A project imported from Status Draft has a full detail page. A user can add a weekly status update in under 60 seconds. Health changes are visible in the audit trail.

### Watch out for
The status update form is the most-used interaction in the app. Do not rush the UX on it. The health selector must be an inline toggle (not a dropdown), and the optional fields must be collapsed by default. Get it right here — it's the interaction users will have every week.

---

## Sprint 3 — Portfolio Dashboard
**Duration:** 2 weeks (~20 hours)
**Goal:** The dashboard gives a real picture of portfolio health at a glance.

### Hard scope
- [ ] Portfolio dashboard (`/dashboard`): KPI stat row (total projects, green/yellow/red counts, overdue milestones)
- [ ] Project grid: cards for all active projects with health badge, owner, due date
- [ ] Portfolio health summary: simple breakdown — X on track, Y at risk, Z off track
- [ ] Recent activity feed: last 5–10 status updates across all projects
- [ ] Empty states: all views covered (no projects, no updates, no reports)
- [ ] Dashboard is a server component — no client-side data fetching for initial render

### Soft scope
- [ ] AI portfolio narrative: "Generate Summary" button → Claude writes a 2-paragraph executive narrative across all active projects
- [ ] Shareable report: generate a `share_token` for any status report, produce a public `/share/[token]` URL

### Definition of done
A user with 5+ projects lands on the dashboard and can see the health of their portfolio without clicking into any project. The page loads in under 2 seconds.

### Watch out for
Dashboard performance. If you're doing N+1 Supabase queries (one per project for latest update), the dashboard will be slow with 15+ projects. Write a single query that joins projects with their most recent update using a lateral join or a view. Do it right here, not as a later optimization.

---

## Sprint 4 — Monetization
**Duration:** 2 weeks (~20 hours)
**Goal:** Stripe is wired. Plan limits are enforced. The app can charge money.

This sprint is a prerequisite for public launch. Nothing ships publicly until billing is live.

### Hard scope
- [ ] Stripe products + prices created in dashboard (Starter, Team, Business — monthly + annual)
- [ ] `POST /api/billing/create-checkout`: creates Stripe Checkout session, redirects user
- [ ] `POST /api/webhooks/stripe`: handles `checkout.session.completed`, `subscription.updated`, `subscription.deleted`, `invoice.payment_failed`
- [ ] `organizations` table updated correctly from webhook events (plan, subscription_status, stripe IDs)
- [ ] Plan limit enforcement: adding a project past the plan limit returns a clear upgrade prompt — not a silent failure
- [ ] User limit enforcement: inviting a user past the plan limit blocked with upgrade prompt
- [ ] `/settings/billing` page: current plan, next billing date, "Upgrade" and "Manage Billing" (Stripe portal) buttons
- [ ] 14-day free trial: `trial_ends_at` set on org creation, enforced in middleware after expiry
- [ ] Trial expiry: user lands on upgrade prompt after trial ends, not a broken app
- [ ] Stripe webhook signature verification — never skip this

### Soft scope
- [ ] Upgrade prompt design: shown inline when limit hit, not as a modal interruption
- [ ] Annual plan toggle on pricing page

### Definition of done
A test user can sign up, use the trial, hit the Starter plan project limit, upgrade via Stripe Checkout, and have their plan reflected immediately in the app. The webhook handler processes all four event types without errors.

### Watch out for
- **Webhook reliability:** Test every event type with the Stripe CLI locally before deploying. `invoice.payment_failed` is the one most developers skip — it's how you catch churned cards.
- **Trial enforcement:** Don't block the app entirely on trial expiry. Let users read their data. Block creating new projects/users only. Rage-quitting because you can't see your own data is a bad last impression.
- **Idempotency:** Stripe can send the same webhook event twice. Make sure `handleCheckoutComplete` doesn't create duplicate org records if called twice with the same session ID.

---

## Sprint 5 — Intake Queue
**Duration:** 2 weeks (~20 hours)
**Goal:** Organizations can receive and triage project requests.

### Hard scope
- [ ] `intake_requests` table migrated + RLS
- [ ] Intake request form (`/intake/new` or public embed URL): title, description, requester name/email, priority request
- [ ] Intake queue (`/intake`): list of pending requests with status, requester, submission date
- [ ] Request detail: view full submission, change status (pending → in_review → approved/rejected)
- [ ] "Convert to Project": approved request creates a project record, `converted_project_id` set
- [ ] AI categorization: on submission, Haiku classifies the request category + suggests priority (async, non-blocking)

### Soft scope
- [ ] Custom intake fields (stored in `form_data` jsonb) — the schema supports it; the UI config is v2
- [ ] Email notification to requester on status change (Resend)

### Definition of done
A user can submit an intake request via a form link, a PMO lead can review it in the queue, approve it, and convert it to a tracked project in one click.

---

## Sprint 6 — Scoring & Prioritization
**Duration:** 2 weeks (~18 hours)
**Goal:** Projects can be scored and ranked by value/effort/risk/alignment.

### Hard scope
- [ ] `project_scores` table migrated + RLS
- [ ] Scoring panel on project detail: four sliders (Value, Effort, Risk, Alignment), composite score displayed
- [ ] Composite score formula: `(Value + Alignment - Effort - Risk) / 4` — simple, explainable, overridable
- [ ] Priority ranking view: projects sorted by composite score, drag to override rank
- [ ] AI-assisted scoring: "Score with AI" button sends project description + recent updates to Haiku → returns suggested scores with one-line rationale per dimension
- [ ] AI badge on any AI-suggested score: "Suggested by AI · You can override this"

### Soft scope
- [ ] Score history: track when scores changed and by whom

### Definition of done
A PMO lead can score all active projects in under 10 minutes and produce a priority-ranked list they could present to leadership.

---

## Launch Gate Checklist

Before any public announcement, all of the following must be true:

**Product**
- [ ] Sprints 0–4 complete and deployed to production
- [ ] Status Draft works on real ADO, Jira, and Smartsheet exports (test with 3 real files)
- [ ] Auth, billing, and plan limits tested end-to-end with a real Stripe test card
- [ ] All six empty states implemented and copy-reviewed
- [ ] Error states for all critical paths (file upload, Claude API, Stripe) handled gracefully
- [ ] `/share/[token]` public report pages render without auth

**Infrastructure**
- [ ] Vercel Pro plan active (60s function timeout, higher bandwidth)
- [ ] Supabase Pro plan active (daily backups, no pausing on inactivity)
- [ ] Stripe webhook endpoint registered and verified in production
- [ ] All secret keys rotated from dev values (new Supabase service role key, new Stripe secret)
- [ ] Error logging: Vercel logs + `console.error` on all catch blocks at minimum

**Legal & Business**
- [ ] LLC formed (or sole proprietor decision made)
- [ ] Privacy Policy live at `/privacy`
- [ ] Terms of Service live at `/terms`
- [ ] Stripe account fully activated (not in test mode)
- [ ] Domain acquired and DNS pointed to Vercel (`app.basefolio.io` or equivalent)

**Go-to-Market**
- [ ] Landing page live with pricing table and "Start free trial" CTA
- [ ] At least 3 beta users actively using the product (not just signed up)
- [ ] LinkedIn announcement post drafted and ready

---

## Post-Launch Backlog (v1.1)

Do not build these before launch. Log them here and revisit after the first paying customer.

| Item | Why Deferred |
|---|---|
| PDF/DOCX export for Status Draft | Markdown download covers beta needs; formatting complexity not worth pre-launch |
| AI portfolio narrative (dashboard) | Soft scope in Sprint 3 — if not built, add here |
| PostHog analytics | 2–3 hours; add week 1 post-launch to start tracking Status Draft activation rate |
| Sentry error tracking | Add after first bug report that can't be diagnosed from Vercel logs |
| Google OAuth | Magic link covers MVP; add when users complain |
| Email notifications | Resend is wired; actual notification triggers are a v1.1 workflow |
| Custom intake fields | Schema supports it; UI config is not worth building pre-launch |
| Milestone/risk detail pages | Lists on project detail are sufficient for beta |
| Audit log UI | Data is captured; export view is Enterprise-tier |
| Annual billing toggle | Monthly only at launch; annual adds Stripe complexity |

---

## Total Estimate

| Phase | Sprints | Weeks | Hours |
|---|---|---|---|
| Foundation | 0 | 1 | ~12 |
| Flagship | 1 | 2 | ~28 |
| Core Governance | 2–3 | 4 | ~45 |
| Monetization | 4 | 2 | ~20 |
| **Launch-ready subtotal** | **0–4** | **9 weeks** | **~105 hours** |
| Intake | 5 | 2 | ~20 |
| Scoring | 6 | 2 | ~18 |
| **Full MVP subtotal** | **0–6** | **13 weeks** | **~143 hours** |

At 10–15 hours/week: launch-ready in **9–11 weeks** (late June / early July 2026). Full MVP in **13–16 weeks** (late July / early August 2026).

These estimates assume AI-assisted development is working well. If a sprint consistently takes 50% longer than estimated, the cause is almost always one of three things: unclear spec (go back to PRD), fighting a third-party integration (timebox it at 3 hours then find a workaround), or scope creep within the sprint (cut soft scope, do not extend the sprint.

---

*This plan is fixed for the purposes of launch planning. Scope changes require an explicit decision — not a quiet addition to a sprint.*
