-- Sprint 1: projects table. Status Draft "Import to Basefolio" lands here,
-- and Sprint 2 will build the full tracking UI on top of it.

-- Reusable updated_at trigger. Already defined in Sprint 0; re-declared with
-- CREATE OR REPLACE so this migration stands on its own if replayed into a
-- fresh database.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- RLS helper resolving the caller's organization_id. Lives in `public` (not
-- `auth`) because hosted Supabase disallows creating objects in the auth
-- schema — Sprint 0 established this. CREATE OR REPLACE makes this idempotent.
create or replace function public.org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.users where id = auth.uid();
$$;

grant execute on function public.org_id() to authenticated;

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  description      text,
  status           text not null default 'active',
  health           text not null default 'green',
  phase            text,
  owner_id         uuid references public.users(id) on delete set null,
  start_date       date,
  target_end_date  date,
  actual_end_date  date,
  priority_score   numeric(5,2),
  tags             text[],
  external_id      text,
  source           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_status_check
    check (status in ('active', 'on_hold', 'completed', 'canceled')),
  constraint projects_health_check
    check (health in ('green', 'yellow', 'red')),
  constraint projects_source_check
    check (source is null or source in ('ado', 'jira', 'smartsheet', 'manual'))
);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Dedup key for re-imports from the same source tool. Partial so manually
-- created projects (no external_id) don't collide with each other.
create unique index projects_org_external_id_idx
  on public.projects (organization_id, external_id)
  where external_id is not null;

-- Dashboards and list views filter by org + status; this index serves both.
create index projects_org_status_idx
  on public.projects (organization_id, status);

alter table public.projects enable row level security;

create policy "projects_select_own_org"
  on public.projects
  for select
  to authenticated
  using (organization_id = public.org_id());

create policy "projects_insert_own_org"
  on public.projects
  for insert
  to authenticated
  with check (organization_id = public.org_id());

create policy "projects_update_own_org"
  on public.projects
  for update
  to authenticated
  using      (organization_id = public.org_id())
  with check (organization_id = public.org_id());

create policy "projects_delete_own_org"
  on public.projects
  for delete
  to authenticated
  using (organization_id = public.org_id());
