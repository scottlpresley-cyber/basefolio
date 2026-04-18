-- Sprint 2 core schema: project tracking tables + AI usage rate-limit log.
--
-- Adds five new tables (project_updates, milestones, risks, audit_log,
-- ai_usage_events). The projects table from Sprint 1 already has every
-- architecture §5 column plus source_report_id (from 20260417000004) —
-- verified against the migration chain — so no ALTER TABLE is needed.
--
-- RLS is enabled on every table from line one. Org scoping uses the
-- existing public.org_id() helper established in Sprint 0. It lives in
-- `public` rather than `auth` because hosted Supabase disallows custom
-- functions in the auth schema (architecture v1.1 decision log).
--
-- organization_id FKs intentionally do NOT cascade. Tenant deletion is
-- a deliberate, multi-step application operation — never a single DB
-- cascade that silently destroys a tenant's data.

-- ---------------------------------------------------------------
-- project_updates
-- ---------------------------------------------------------------
-- Weekly status updates on a project. Feed view on /projects/[id]
-- reads from here. ai_risk_flags is populated by a downstream classify
-- call after the update lands.
create table public.project_updates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  project_id       uuid not null references public.projects(id) on delete cascade,
  author_id        uuid references public.users(id) on delete set null,
  period_start     date,
  period_end       date,
  health           text not null,
  summary          text not null,
  accomplishments  text,
  next_steps       text,
  blockers         text,
  ai_risk_flags    jsonb,
  created_at       timestamptz not null default now(),
  constraint project_updates_health_check
    check (health in ('green', 'yellow', 'red'))
);

-- Serves the project detail page's updates feed and dashboard activity.
create index project_updates_project_created_idx
  on public.project_updates (project_id, created_at desc);

alter table public.project_updates enable row level security;

create policy "project_updates_select_own_org"
  on public.project_updates
  for select
  using (organization_id = public.org_id());

create policy "project_updates_insert_own_org"
  on public.project_updates
  for insert
  with check (organization_id = public.org_id());

create policy "project_updates_update_own_org"
  on public.project_updates
  for update
  using      (organization_id = public.org_id())
  with check (organization_id = public.org_id());

create policy "project_updates_delete_own_org"
  on public.project_updates
  for delete
  using (organization_id = public.org_id());


-- ---------------------------------------------------------------
-- milestones
-- ---------------------------------------------------------------
-- Date-based checkpoints per project. Dashboard overdue count reads
-- this table; project detail lists milestones chronologically.
create table public.milestones (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  project_id       uuid not null references public.projects(id) on delete cascade,
  name             text not null,
  due_date         date,
  completed_at     timestamptz,
  status           text default 'pending',
  created_at       timestamptz not null default now(),
  constraint milestones_status_check
    check (status in ('pending', 'complete', 'at_risk', 'missed'))
);

create index milestones_project_due_idx
  on public.milestones (project_id, due_date);

alter table public.milestones enable row level security;

create policy "milestones_select_own_org"
  on public.milestones
  for select
  using (organization_id = public.org_id());

create policy "milestones_insert_own_org"
  on public.milestones
  for insert
  with check (organization_id = public.org_id());

create policy "milestones_update_own_org"
  on public.milestones
  for update
  using      (organization_id = public.org_id())
  with check (organization_id = public.org_id());

create policy "milestones_delete_own_org"
  on public.milestones
  for delete
  using (organization_id = public.org_id());


-- ---------------------------------------------------------------
-- risks
-- ---------------------------------------------------------------
-- Risk register per project.
create table public.risks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  project_id       uuid not null references public.projects(id) on delete cascade,
  description      text not null,
  probability      text,
  impact           text,
  status           text default 'open',
  owner_id         uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint risks_probability_check
    check (probability is null or probability in ('low', 'medium', 'high')),
  constraint risks_impact_check
    check (impact is null or impact in ('low', 'medium', 'high')),
  constraint risks_status_check
    check (status in ('open', 'mitigated', 'closed'))
);

create index risks_project_status_idx
  on public.risks (project_id, status);

alter table public.risks enable row level security;

create policy "risks_select_own_org"
  on public.risks
  for select
  using (organization_id = public.org_id());

create policy "risks_insert_own_org"
  on public.risks
  for insert
  with check (organization_id = public.org_id());

create policy "risks_update_own_org"
  on public.risks
  for update
  using      (organization_id = public.org_id())
  with check (organization_id = public.org_id());

create policy "risks_delete_own_org"
  on public.risks
  for delete
  using (organization_id = public.org_id());


-- ---------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------
-- Append-only record of significant state changes (e.g. project health
-- changes). entity_id intentionally has no FK — audit rows must survive
-- deletion of their target row for forensic integrity.
create table public.audit_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  user_id          uuid references public.users(id) on delete set null,
  action           text not null,
  entity_type      text,
  entity_id        uuid,
  old_value        jsonb,
  new_value        jsonb,
  created_at       timestamptz not null default now()
);

-- Required by prompt: efficient org-scoped audit browsing, newest first.
create index audit_log_org_created_at_idx
  on public.audit_log (organization_id, created_at desc);

alter table public.audit_log enable row level security;

-- SELECT + INSERT only. Audit log is append-only from server code; no
-- UI-driven updates or deletes in MVP. Absence of UPDATE/DELETE policies
-- on an RLS-enabled table means those operations are fully denied for
-- non-service-role clients.
create policy "audit_log_select_own_org"
  on public.audit_log
  for select
  using (organization_id = public.org_id());

create policy "audit_log_insert_own_org"
  on public.audit_log
  for insert
  with check (organization_id = public.org_id());


-- ---------------------------------------------------------------
-- ai_usage_events
-- ---------------------------------------------------------------
-- Per-call record of Claude usage. Powers per-user rate limiting and
-- org-level cost attribution. Added to Sprint 2 scope via security
-- review. Immutable: SELECT + INSERT only, no UPDATE or DELETE policies.
-- user_id is nullable + SET NULL on user deletion so billing and
-- forensic records survive account closure; the rate-limit lookup
-- ignores null-user rows since they match no live user.
create table public.ai_usage_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  user_id          uuid references public.users(id) on delete set null,
  event_type       text not null,
  model            text,
  tokens_in        int,
  tokens_out       int,
  cost_usd         numeric(10,6),
  created_at       timestamptz not null default now(),
  constraint ai_usage_events_event_type_check
    check (event_type in ('status_draft_generate', 'narrative', 'classify', 'status_assist')),
  constraint ai_usage_events_model_check
    check (model is null or model in ('narrative', 'classify'))
);

-- Required by prompt: org-level usage rollups.
create index ai_usage_events_org_created_idx
  on public.ai_usage_events (organization_id, created_at desc);

-- Required by prompt: per-user rate-limit window lookup.
-- Query shape: "count events for (user_id, event_type) in the last N minutes".
create index ai_usage_events_user_event_created_idx
  on public.ai_usage_events (user_id, event_type, created_at desc);

alter table public.ai_usage_events enable row level security;

create policy "ai_usage_events_select_own_org"
  on public.ai_usage_events
  for select
  using (organization_id = public.org_id());

create policy "ai_usage_events_insert_own_org"
  on public.ai_usage_events
  for insert
  with check (organization_id = public.org_id());
