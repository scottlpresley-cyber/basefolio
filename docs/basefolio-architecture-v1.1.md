# Basefolio — Architecture Document v1.1

*Option A: Solo, AI-assisted build. Speed over formality.*
*Last updated: April 17, 2026*

---

## 1. Guiding Principles for This Build

These decisions are final for MVP. Revisit at v2.

- **Next.js App Router** all the way — server components by default, client components only when interactivity requires it.
- **Supabase handles auth, data, and storage.** Do not introduce a separate ORM, queue, or cache layer in MVP.
- **One Claude API integration pattern.** All AI calls go through a single server-side utility. No AI calls from the client.
- **File processing is server-side only.** XLSX/CSV parsing happens in a Next.js Route Handler, never in the browser.
- **Stripe Checkout, not a custom payment UI.** Stripe-hosted checkout for v1. Build the portal integration, not custom billing pages.
- **No job queues in MVP.** Status Draft generation is synchronous via streaming. If a request takes 30 seconds, the UI handles it gracefully. Queues are a v2 problem.

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────┐
│                        BROWSER                          │
│  Next.js App (React Server + Client Components)         │
│  Deployed on Vercel (Edge + Serverless Functions)       │
└────────────────┬────────────────┬───────────────────────┘
                 │                │
        ┌────────▼──────┐  ┌──────▼──────────┐
        │   Supabase    │  │   Claude API    │
        │  PostgreSQL   │  │  (Anthropic)    │
        │  Auth (JWT)   │  │ Sonnet 4.6 tier │
        │  Storage      │  └─────────────────┘
        │  Row-Level    │
        │  Security     │
        └────────┬──────┘
                 │
        ┌────────▼──────┐
        │    Stripe     │
        │  Checkout +   │
        │  Webhooks     │
        └───────────────┘
```

**Request flow for most pages:**
Browser → Vercel Edge → Next.js RSC fetches from Supabase via service role → renders HTML → ships to browser.

**Request flow for Status Draft:**
Browser uploads file → Next.js Route Handler → parse XLSX/CSV → compute metrics → stream Claude API response → return structured JSON + narrative.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14+ (App Router) | RSC reduces client bundle; Vercel deployment is zero-config |
| Styling | Tailwind CSS | Fast iteration; no custom CSS files to maintain |
| UI components | shadcn/ui | Unstyled primitives, easy to theme to Basefolio brand |
| Database | Supabase (PostgreSQL) | Auth + DB + Storage + RLS in one bill |
| Auth | Supabase Auth | Magic link + OAuth; org invite flow baked in |
| File storage | Supabase Storage | Upload staging for Status Draft files |
| AI | Anthropic Claude API | Sonnet 4.6 for narrative; Haiku 4.5 for classification |
| Billing | Stripe | Checkout + Customer Portal + Webhooks |
| Hosting | Vercel | Zero-config Next.js; preview deploys; free tier |
| Email | Resend | Transactional email; free tier covers early growth |
| File parsing | xlsx (SheetJS) + papaparse | XLSX and CSV parsing in Node.js |

---

## 4. Repository Structure

```
basefolio/
├── app/                        # Next.js App Router
│   ├── (marketing)/            # Route group — public pages, no auth
│   │   ├── page.tsx            # Landing page
│   │   ├── pricing/page.tsx
│   │   └── layout.tsx
│   ├── (auth)/                 # Route group — login, signup, invite
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── invite/page.tsx
│   ├── (app)/                  # Route group — authenticated app
│   │   ├── layout.tsx          # Auth guard + org context
│   │   ├── dashboard/page.tsx  # Portfolio dashboard
│   │   ├── projects/
│   │   │   ├── page.tsx        # Project list
│   │   │   └── [id]/page.tsx   # Project detail
│   │   ├── intake/page.tsx     # Intake queue
│   │   ├── reports/
│   │   │   ├── page.tsx        # Report history
│   │   │   └── [id]/page.tsx   # Report detail / shared view
│   │   └── settings/page.tsx   # Org settings, billing, users
│   └── api/                    # Route Handlers (server-side only)
│       ├── status-draft/
│       │   ├── upload/route.ts     # File upload + parse
│       │   └── generate/route.ts   # Claude generation (streaming)
│       ├── ai/
│       │   ├── narrative/route.ts  # Portfolio narrative
│       │   └── classify/route.ts   # Intake categorization
│       ├── webhooks/
│       │   └── stripe/route.ts     # Stripe event handler
│       └── share/[token]/route.ts  # Public report share
├── components/
│   ├── ui/                     # shadcn/ui primitives (auto-generated)
│   ├── layout/                 # Sidebar, TopNav, PageHeader
│   ├── projects/               # ProjectCard, HealthIndicator, etc.
│   ├── reports/                # ReportViewer, StatusSection, etc.
│   ├── intake/                 # IntakeForm, RequestCard, etc.
│   └── status-draft/           # UploadZone, ParsePreview, GenerateButton
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser client (anon key)
│   │   ├── server.ts           # Server client (service role)
│   │   └── middleware.ts       # Auth token refresh
│   ├── ai/
│   │   ├── claude.ts           # Claude API wrapper (all AI calls go here)
│   │   ├── prompts/            # Prompt templates as .ts files
│   │   │   ├── status-draft.ts
│   │   │   ├── narrative.ts
│   │   │   └── classify.ts
│   │   └── parsers/            # Response parsers
│   ├── file-processing/
│   │   ├── parse.ts            # XLSX/CSV → normalized row array
│   │   ├── detect-schema.ts    # Column inference (Jira, ADO, Smartsheet)
│   │   ├── group-projects.ts   # Row grouping → project objects
│   │   └── compute-metrics.ts  # Pre-compute health, counts, etc.
│   ├── stripe/
│   │   ├── client.ts           # Stripe SDK instance
│   │   └── plans.ts            # Plan definitions + limits
│   └── utils/
│       ├── date.ts
│       └── format.ts
├── types/
│   ├── database.types.ts       # Auto-generated from Supabase
│   └── app.types.ts            # App-level types (not DB)
├── supabase/
│   ├── migrations/             # SQL migration files
│   └── seed.sql                # Dev seed data
├── middleware.ts               # Next.js middleware (auth guard)
└── .env.local                  # Secrets (never committed)
```

---

## 5. Data Model

### Multi-tenancy pattern

Every table includes `organization_id`. Row-Level Security (RLS) policies enforce that users only read/write rows belonging to their organization. The `organization_id` is always derived from the authenticated user's session via a DB function — never trusted from the client request body.

The helper function lives in the `public` schema because hosted Supabase restricts custom function creation in the `auth` schema. Semantically identical to placing it in `auth`; the namespace is the only difference.

```sql
-- Helper used in all RLS policies
CREATE OR REPLACE FUNCTION public.org_id()
RETURNS uuid AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

### Core Tables

```sql
-- Organizations (tenants)
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text UNIQUE NOT NULL,
  plan          text NOT NULL DEFAULT 'starter', -- starter | team | business | enterprise
  stripe_customer_id  text UNIQUE,
  stripe_subscription_id text UNIQUE,
  subscription_status   text, -- active | trialing | past_due | canceled
  trial_ends_at  timestamptz,
  created_at     timestamptz DEFAULT now()
);

-- Users (linked to Supabase Auth)
CREATE TABLE users (
  id               uuid PRIMARY KEY REFERENCES auth.users(id),
  organization_id  uuid REFERENCES organizations(id),
  email            text NOT NULL,
  full_name        text,
  role             text NOT NULL DEFAULT 'member', -- owner | admin | member | viewer
  created_at       timestamptz DEFAULT now()
);

-- Projects
CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  name             text NOT NULL,
  description      text,
  status           text NOT NULL DEFAULT 'active', -- active | on_hold | completed | canceled
  health           text NOT NULL DEFAULT 'green',  -- green | yellow | red
  phase            text,           -- e.g. "Planning", "Execution", "Closing"
  owner_id         uuid REFERENCES users(id),
  start_date       date,
  target_end_date  date,
  actual_end_date  date,
  priority_score   numeric(5,2),   -- computed from scoring framework
  tags             text[],
  external_id      text,           -- original ID from source tool (ADO, Jira)
  source           text,           -- ado | jira | smartsheet | manual
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- Project Status Updates
CREATE TABLE project_updates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id        uuid REFERENCES users(id),
  period_start     date,
  period_end       date,
  health           text NOT NULL,  -- green | yellow | red
  summary          text NOT NULL,  -- free-text or AI-assisted
  accomplishments  text,
  next_steps       text,
  blockers         text,
  ai_risk_flags    jsonb,          -- surfaced risk signals from text
  created_at       timestamptz DEFAULT now()
);

-- Milestones
CREATE TABLE milestones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             text NOT NULL,
  due_date         date,
  completed_at     timestamptz,
  status           text DEFAULT 'pending', -- pending | complete | at_risk | missed
  created_at       timestamptz DEFAULT now()
);

-- Risks
CREATE TABLE risks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description      text NOT NULL,
  probability      text,   -- low | medium | high
  impact           text,   -- low | medium | high
  status           text DEFAULT 'open', -- open | mitigated | closed
  owner_id         uuid REFERENCES users(id),
  created_at       timestamptz DEFAULT now()
);

-- Intake Requests
CREATE TABLE intake_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  submitted_by     uuid REFERENCES users(id),
  title            text NOT NULL,
  description      text,
  requester_name   text,
  requester_email  text,
  priority_request text,
  status           text DEFAULT 'pending', -- pending | in_review | approved | rejected | converted
  ai_category      text,        -- AI-inferred category
  ai_priority_suggestion text,
  converted_project_id uuid REFERENCES projects(id),
  form_data        jsonb,       -- flexible field storage for custom intake fields
  created_at       timestamptz DEFAULT now()
);

-- Project Scores
CREATE TABLE project_scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  value_score      numeric(3,1),   -- 0-10
  effort_score     numeric(3,1),   -- 0-10 (lower = less effort = better)
  risk_score       numeric(3,1),   -- 0-10 (lower = less risk = better)
  alignment_score  numeric(3,1),   -- 0-10
  composite_score  numeric(5,2),   -- computed
  ai_assisted      boolean DEFAULT false,
  scoring_notes    text,
  updated_at       timestamptz DEFAULT now()
);

-- Status Reports (generated by Status Draft or weekly narrative)
CREATE TABLE status_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  created_by       uuid REFERENCES users(id),
  report_type      text NOT NULL, -- status_draft | weekly_narrative
  title            text,
  period_start     date,
  period_end       date,
  content          jsonb NOT NULL,  -- structured report content
  narrative        text,            -- executive narrative text
  share_token      text UNIQUE,     -- null = not shared; set = public link active
  source_file_name text,            -- original upload filename (Status Draft)
  project_count    int,
  created_at       timestamptz DEFAULT now()
);

-- Audit Log
CREATE TABLE audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  user_id          uuid REFERENCES users(id),
  action           text NOT NULL,   -- e.g. "project.health_changed"
  entity_type      text,            -- e.g. "project"
  entity_id        uuid,
  old_value        jsonb,
  new_value        jsonb,
  created_at       timestamptz DEFAULT now()
);
```

### RLS Policy Pattern

```sql
-- Example for projects table (all tables follow this pattern)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read their projects"
  ON projects FOR SELECT
  USING (organization_id = public.org_id());

CREATE POLICY "org admins can insert projects"
  ON projects FOR INSERT
  WITH CHECK (organization_id = public.org_id());

CREATE POLICY "org admins can update projects"
  ON projects FOR UPDATE
  USING (organization_id = public.org_id());
```

### Plan Limits Enforcement

Plan limits (users, projects) are enforced at the API route level before insert, not via DB constraints. This keeps enforcement logic readable and in one place.

```typescript
// lib/stripe/plans.ts
export const PLAN_LIMITS = {
  starter:    { maxUsers: 5,  maxProjects: 15 },
  team:       { maxUsers: 15, maxProjects: 40 },
  business:   { maxUsers: 40, maxProjects: Infinity },
  enterprise: { maxUsers: Infinity, maxProjects: Infinity },
} as const;
```

---

## 6. Authentication & Organization Flow

### Auth strategy: Supabase Auth + magic link

- Default: magic link (no password friction for new users)
- Social: Google OAuth optional, added in v2
- No username/password in MVP

### Organization provisioning flow

```
1. User signs up (magic link)
2. POST /api/org/create → creates organization + user row + sets role=owner
3. Redirect to /dashboard (empty state with onboarding CTA)
4. Owner invites team via /settings/team → Supabase invite email → 
   invited user clicks link → account created → joined to org
```

### Middleware (auth guard)

```typescript
// middleware.ts
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request)
  const { data: { session } } = await supabase.auth.getSession()
  
  const isAppRoute = request.nextUrl.pathname.startsWith('/(app)')
  
  if (!session && isAppRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return response
}
```

---

## 7. Status Draft Pipeline

This is the flagship feature. The pipeline is deliberately simple for MVP.

### Step-by-step

```
[1] UPLOAD
  User selects file (CSV or XLSX, max 10MB)
  POST /api/status-draft/upload
  → Store in Supabase Storage (temp bucket, 24hr TTL)
  → Parse file in memory (never touch disk on Vercel)
  → Return: raw rows, inferred column map, detected source tool

[2] COLUMN MAPPING
  Client receives inferred map
  UI shows preview: "We think these columns are: Title, Status, Owner..."
  User can correct mappings before proceeding
  If confidence > 0.85 on all required fields → auto-proceed, show confirmation

[3] PROJECT GROUPING
  POST /api/status-draft/generate with { storageKey, columnMap }
  Server groups rows into projects by:
    Priority: Area Path → Epic → Iteration → Tag → fallback "Ungrouped"
  Computes per-project metrics:
    - item count by status (complete, in-progress, blocked, not-started)
    - % complete
    - overdue item count
    - inferred health (red if >20% blocked or overdue, yellow if >10%, else green)
    - owner (mode of assigned-to column)

[4] AI NARRATIVE GENERATION (streaming)
  Single Claude API call with structured project data as context
  System prompt: portfolio analyst persona, concise executive voice
  Returns streaming text → client renders incrementally
  Final response includes per-project sections + exec summary

[5] OUTPUT
  Client renders full report
  Actions: Download PDF | Download DOCX | Copy to clipboard | Import to Basefolio
  "Import to Basefolio" → creates project records from the report data
```

### Column inference — source detection

```typescript
// lib/file-processing/detect-schema.ts

const SOURCE_SIGNATURES = {
  ado: ['Area Path', 'Iteration Path', 'Work Item Type', 'Assigned To'],
  jira: ['Issue Type', 'Epic Link', 'Sprint', 'Assignee', 'Story Points'],
  smartsheet: ['Row ID', 'Modified', 'Duration', 'Predecessors', 'Assigned To'],
} as const

// Returns: { source: 'ado' | 'jira' | 'smartsheet' | 'unknown', confidence: number, columnMap }
export function detectSchema(headers: string[]): SchemaDetectionResult { ... }
```

### Claude prompt structure for Status Draft

```typescript
// lib/ai/prompts/status-draft.ts

export function buildStatusDraftPrompt(projects: ComputedProject[]): string {
  return `
You are a senior PMO analyst writing a weekly portfolio status report.

Write a concise, professional status report for the following project portfolio.
Format each project as a structured section, then write a 2-3 paragraph executive summary.

Use this tone: direct, clear, no jargon. Flag risks plainly. Don't pad with filler.

PORTFOLIO DATA:
${JSON.stringify(projects, null, 2)}

OUTPUT FORMAT:
## Executive Summary
[2-3 paragraphs: overall portfolio health, key wins, key risks, watch items]

## Project Status

### [Project Name] — [GREEN/YELLOW/RED]
**Progress:** X of Y items complete (Z%)
**This period:** [key accomplishments]
**Next steps:** [what's coming]
**Blockers/Risks:** [if any — be specific]

[repeat for each project]
`
}
```

---

## 8. AI Integration Pattern

**Rule: All Claude API calls go through `lib/ai/claude.ts`. No exceptions.**

This gives one place to handle rate limits, errors, logging, and model swaps.

```typescript
// lib/ai/claude.ts

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type AIModel = 'narrative' | 'classify'

const MODEL_MAP: Record<AIModel, string> = {
  narrative: 'claude-sonnet-4-6',           // Status Draft, portfolio narratives
  classify:  'claude-haiku-4-5-20251001',   // Intake categorization, risk flagging
}

export async function callClaude({
  model,
  system,
  prompt,
  maxTokens = 2000,
  stream = false,
}: ClaudeCallParams) {
  if (stream) {
    return client.messages.stream({
      model: MODEL_MAP[model],
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
  }
  
  return client.messages.create({
    model: MODEL_MAP[model],
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
}
```

Note on model identifiers: Anthropic publishes Sonnet 4.6 with the same string as both its Claude API ID and its alias — `claude-sonnet-4-6` is the canonical identifier, not a moving alias. Haiku 4.5 uses the dated form `claude-haiku-4-5-20251001` because Anthropic publishes a distinct dated ID for it. Verify at https://platform.claude.com/docs/en/about-claude/models/overview before a model swap.

### Streaming to the client

Status Draft uses streaming so the report appears progressively rather than after a 20-second wait.

```typescript
// app/api/status-draft/generate/route.ts

export async function POST(request: Request) {
  // ... validate auth, parse body, compute metrics ...
  
  const stream = await callClaude({
    model: 'narrative',
    system: PORTFOLIO_ANALYST_SYSTEM,
    prompt: buildStatusDraftPrompt(computedProjects),
    maxTokens: 4000,
    stream: true,
  })
  
  // Pipe Anthropic's stream to a ReadableStream for the browser
  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
          }
        }
        controller.close()
      }
    }),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  )
}
```

---

## 9. Stripe Integration

### Plan → Stripe product mapping

Create one Price per plan per billing period in Stripe dashboard. Store Price IDs in env vars.

```
STRIPE_STARTER_MONTHLY=price_xxx
STRIPE_STARTER_ANNUAL=price_xxx
STRIPE_TEAM_MONTHLY=price_xxx
STRIPE_TEAM_ANNUAL=price_xxx
STRIPE_BUSINESS_MONTHLY=price_xxx
STRIPE_BUSINESS_ANNUAL=price_xxx
```

### Checkout flow

```
1. User clicks "Upgrade" in /settings/billing
2. POST /api/billing/create-checkout → Stripe Checkout Session
   - customer: stripe_customer_id (create if null)
   - line_items: [selected price id]
   - success_url: /settings/billing?success=1
   - cancel_url: /settings/billing
3. Redirect to Stripe-hosted checkout
4. Stripe fires checkout.session.completed webhook
5. POST /api/webhooks/stripe → update organizations.plan + subscription fields
```

### Webhook handler (critical path)

```typescript
// app/api/webhooks/stripe/route.ts

export async function POST(request: Request) {
  const sig = request.headers.get('stripe-signature')!
  const body = await request.text()
  
  // Always verify signature first
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object)
      break
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionCanceled(event.data.object)
      break
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object)
      break
  }
  
  return new Response('ok')
}
```

---

## 10. File Storage

Supabase Storage handles two buckets:

| Bucket | Purpose | Policy | TTL |
|---|---|---|---|
| `status-draft-uploads` | Temp staging for uploaded XLSX/CSV | Private (service role only) | 24hr (cron cleanup) |
| `report-exports` | Generated PDF/DOCX downloads | Private (org-scoped) | 30 days |

Files are never stored long-term for Status Draft. Once the report is generated and the session ends, the uploaded file is not needed.

---

## 11. Shared Reports (Public Links)

When a user clicks "Share Report," a `share_token` (UUID) is set on the `status_reports` row. The public URL is `/share/[token]`.

```typescript
// app/share/[token]/page.tsx — NO auth required, server component

export default async function SharedReportPage({ params }) {
  const supabase = createServerClient() // service role — bypasses RLS for this read
  
  const { data: report } = await supabase
    .from('status_reports')
    .select('*')
    .eq('share_token', params.token)
    .single()
    
  if (!report) return notFound()
  
  return <ReportViewer report={report} readOnly />
}
```

Revoking the share sets `share_token = null`. The old URL immediately returns 404.

---

## 12. Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # server-side only, never exposed to browser

# Anthropic
ANTHROPIC_API_KEY=             # server-side only

# Stripe
STRIPE_SECRET_KEY=             # server-side only
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Resend (email)
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=https://app.basefolio.io
```

**Hard rule:** Any `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, or `STRIPE_SECRET_KEY` must never appear in a `NEXT_PUBLIC_` variable or in any client component.

---

## 13. Deployment

- **Vercel project** connected to the GitHub repo. Main branch → production. Feature branches → preview deploys.
- **Supabase project** in same region as Vercel (US East recommended for both).
- **Database migrations** run via `supabase db push` from local CLI before deploys. Migration files committed to `/supabase/migrations/`.
- **Stripe webhooks** registered to `https://app.basefolio.io/api/webhooks/stripe` (production) and a local CLI listener for dev.

### Vercel environment config

| Variable scope | Where set |
|---|---|
| All `NEXT_PUBLIC_` vars | Vercel dashboard, all environments |
| Secret keys | Vercel dashboard, production only |
| Preview env secrets | Vercel dashboard, preview environment (can use test keys) |

---

## 14. Key Decisions Log

These were considered and decided. Don't re-litigate in MVP.

| Decision | Choice | Rejected Alternative | Reason |
|---|---|---|---|
| ORM | None (Supabase client + typed queries) | Prisma, Drizzle | Supabase client + codegen types are sufficient; avoids migration complexity |
| Job queue | None (synchronous) | Inngest, Trigger.dev | MVP doesn't need it; adds operational surface area |
| State management | React Server Components + minimal client state | Zustand, Redux | App Router makes most state unnecessary at client level |
| AI streaming | ReadableStream via route handler | WebSockets | Simpler; no persistent connection needed |
| File upload | Direct to route handler → Supabase Storage | Presigned upload | Simpler flow; file is transient anyway |
| Email | Resend | SendGrid, Postmark | Cheapest with best DX for transactional; no legacy baggage |
| Analytics | PostHog (add in v1.1) | Mixpanel, Amplitude | Out of scope for launch week |
| Error tracking | Sentry (add in v1.1) | None | Out of scope for launch week; console.error + Vercel logs for MVP |
| Helper function schema (v1.1) | `public.org_id()` | `auth.org_id()` | Hosted Supabase disallows custom functions in the `auth` schema. Semantically identical; namespace-only change. |
| Narrative model (v1.1) | `claude-sonnet-4-6` | `claude-sonnet-4-20250514` (locked in v1.0) | Sonnet 4.6 shipped Feb 2026 with improvements across reasoning, long-context handling, and output quality. Flagship Status Draft quality is the top priority. Anthropic publishes `claude-sonnet-4-6` as both the API ID and alias — it is the canonical stable identifier, not a moving alias. |

---

## 15. What's Not in This Architecture (MVP Scope Boundary)

The following are explicitly deferred. Do not build them during MVP.

- Background job processing (queues, cron-based reports)
- Native integrations (OAuth to ADO/Jira/Smartsheet)
- Real-time collaboration / live updates (Supabase Realtime subscriptions)
- Custom report builder
- Multi-portfolio hierarchy
- Resource capacity / budget tracking
- Mobile native app
- SSO / SAML (Enterprise tier, post-launch)
- Audit export / compliance features (Enterprise tier)

---

## Changelog

**v1.1 — April 17, 2026**
- Moved RLS helper function from `auth.org_id()` to `public.org_id()` (hosted Supabase restriction). All policy examples and the function definition in section 5 updated.
- Swapped narrative model from `claude-sonnet-4-20250514` to `claude-sonnet-4-6`. Haiku unchanged.
- Section 2 diagram updated to "Sonnet 4.6 tier".
- Section 3 tech stack row updated with specific model generations.
- Section 8 gained a short note on the Anthropic model identifier convention (why Sonnet is un-dated but Haiku is dated).
- Two entries added to the Decisions Log.

**v1.0 — April 15, 2026**
- Initial architecture baseline.

---

*This document is the architecture baseline for MVP. Changes require explicit decision with rationale noted in section 14.*
