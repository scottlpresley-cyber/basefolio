-- Basefolio initial schema: organizations, users, org-scoped RLS.

-- Reusable trigger function. Attach to any future table that declares an
-- `updated_at timestamptz` column:
--   create trigger set_updated_at before update on <table>
--   for each row execute function public.set_updated_at();
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One row per tenant. Stripe columns are populated by webhook handlers.
create table public.organizations (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique,
  plan                   text not null default 'free',
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  subscription_status    text,
  trial_ends_at          timestamptz,
  created_at             timestamptz not null default now()
);

-- Application-side user profile mirroring auth.users, scoped to one org.
create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  full_name       text,
  role            text not null default 'member',
  created_at      timestamptz not null default now()
);

-- RLS checks on other tables filter by organization_id, so this index is hot.
create index users_organization_id_idx on public.users (organization_id);

-- Resolves the caller's organization_id from their JWT. Called by every RLS
-- policy below. SECURITY DEFINER bypasses RLS on public.users so the lookup
-- itself doesn't recurse through the same policies it's evaluating.
-- search_path is locked to '' to prevent search-path hijacking; all objects
-- are schema-qualified.
create or replace function auth.org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.users where id = auth.uid();
$$;

grant execute on function auth.org_id() to authenticated;

alter table public.organizations enable row level security;
alter table public.users         enable row level security;

-- Organizations: members see and edit their own org row. Inserts and deletes
-- are intentionally not exposed to authenticated clients — handled by the
-- signup flow and Stripe webhook handlers using the service role.
create policy "organizations_select_own"
  on public.organizations
  for select
  to authenticated
  using (id = auth.org_id());

create policy "organizations_update_own"
  on public.organizations
  for update
  to authenticated
  using      (id = auth.org_id())
  with check (id = auth.org_id());

-- Users: members can read every user in their org; each user can edit only
-- their own profile. Role changes and invites go through server-side flows
-- using the service role.
create policy "users_select_same_org"
  on public.users
  for select
  to authenticated
  using (organization_id = auth.org_id());

create policy "users_update_self"
  on public.users
  for update
  to authenticated
  using      (id = auth.uid())
  with check (id = auth.uid());
