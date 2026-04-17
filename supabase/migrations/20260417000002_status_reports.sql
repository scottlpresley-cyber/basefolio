-- Sprint 1: status_reports table. Each generated Status Draft is persisted
-- here; share_token enables the public /share/[token] route.

create table public.status_reports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  created_by       uuid references public.users(id) on delete set null,
  report_type      text not null,
  title            text,
  period_start     date,
  period_end       date,
  content          jsonb not null,
  narrative        text,
  share_token      text unique,
  source_file_name text,
  project_count    int,
  created_at       timestamptz not null default now(),
  constraint status_reports_report_type_check
    check (report_type in ('status_draft', 'weekly_narrative'))
);

-- Recent-first listing per org for /reports.
create index status_reports_org_created_at_idx
  on public.status_reports (organization_id, created_at desc);

-- Fast lookup for the public share page. Partial because most rows have
-- share_token null; indexing nulls would bloat the index for no benefit.
create unique index status_reports_share_token_idx
  on public.status_reports (share_token)
  where share_token is not null;

alter table public.status_reports enable row level security;

-- Org-scoped policies only. The /share/[token] route reads via the service
-- role client, which bypasses RLS — intentionally no public SELECT policy to
-- keep the attack surface narrow.
create policy "status_reports_select_own_org"
  on public.status_reports
  for select
  to authenticated
  using (organization_id = public.org_id());

create policy "status_reports_insert_own_org"
  on public.status_reports
  for insert
  to authenticated
  with check (organization_id = public.org_id());

create policy "status_reports_update_own_org"
  on public.status_reports
  for update
  to authenticated
  using      (organization_id = public.org_id())
  with check (organization_id = public.org_id());

create policy "status_reports_delete_own_org"
  on public.status_reports
  for delete
  to authenticated
  using (organization_id = public.org_id());
