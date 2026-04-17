@AGENTS.md
# Basefolio — Claude Code Context

## Stack
Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (PostgreSQL + Auth + Storage),
Anthropic Claude API, Stripe, Vercel deployment.

## Architecture Rules
- Server components by default. Client components only when interactivity requires it.
- All Claude API calls go through lib/ai/claude.ts only. Never from client components.
- All file processing (XLSX/CSV) in Route Handlers server-side only.
- Never expose SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, or STRIPE_SECRET_KEY to the browser.
- No ORMs. Supabase client with typed queries only.
- No job queues. Use streaming responses for async operations.
- Use @supabase/ssr package — NOT the legacy @supabase/auth-helpers-nextjs.

## Styling Rules
Brand tokens are defined in app/globals.css inside the @theme block.
Use token names like bg-navy, text-teal, bg-surface — Tailwind v4 
maps CSS custom properties to utility classes automatically.
  Correct: bg-navy, text-teal, bg-surface, text-text-muted
  Wrong: bg-[#1A1A2E], text-[#00B4D8]
- No gradients in the app UI.
- No shadow-xl or larger. shadow or shadow-md maximum.
- No border-radius larger than rounded-lg (12px) on cards.
- No full-page loading spinners. Skeleton loaders or optimistic UI only.
- No emojis anywhere in the UI.
- No placeholder avatar images. Initials in a colored circle (bg-blue text-white).
- No <table> elements. CSS Grid for all data tables.
- Health colors (health-green, health-yellow, health-red) reserved for project health only.
- No inline styles. Tailwind tokens only.
- No text-black. Use text-text-primary.

## UI Copy Rules
- Write actions not features: "Add a project" not "Project Management"
- Empty states explain value: "Projects you're tracking will appear here"
- Errors tell users what to do: "Export as .xlsx or .csv and try again"
- Confirmations are specific: "Project saved." not "Great! You're all set!"
- Never say "please" in UI copy.
- Button labels: "Add [thing]" to create, "Save Changes" to update, "Delete [thing]" to destroy.

## Key Patterns (see ui-context.md for full specs)
1. Sidebar Navigation — navy bg, white text, teal active indicator
2. Project Card — grid and list variants
3. Health Indicators — badge, dot, and pill variants
4. Data Tables — CSS Grid, not <table>
5. Empty States — icon + heading + body + single CTA
6. Status Update Form — inline health toggle, summary required, rest collapsed

## Out of Scope (do not build or suggest)
Job queues, real-time subscriptions, native mobile, custom report builder,
SSO/SAML, resource capacity, budget tracking, Gantt charts, multi-portfolio hierarchy.

## Reference Documents
- docs/architecture.md — system architecture, data model, multi-tenancy 
  pattern, all key decisions
- docs/ui-context.md — the six load-bearing UI component patterns, color 
  rules, microcopy guide
- supabase/migrations/ — all schema changes; review before writing any 
  new tables

Always read docs/architecture.md before writing database schema, 
API routes, or Supabase queries.