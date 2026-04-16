-- Basefolio initial schema: organizations, users, org-scoped RLS.

-- Reusable trigger function for any table with an `updated_at timestamptz`
-- column. Attached to organizations below; attach to future tables with:
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
  plan                   text not null default 'starter',
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  subscription_status    text,
  trial_ends_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

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
-- policy below. Lives in `public` (not `auth`) because hosted Supabase
-- projects disallow creating objects in the auth schema. The auth.uid()
-- call inside the body is the built-in Supabase helper and stays as-is.
-- SECURITY DEFINER bypasses RLS on public.users so the lookup itself
-- doesn't recurse through the same policies it's evaluating. search_path
-- is locked to '' to prevent search-path hijacking; all objects are
-- schema-qualified.
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

alter table public.organizations enable row level security;
alter table public.users         enable row level security;

-- Organizations: members see and edit their own org row. Inserts and deletes
-- are intentionally not exposed to authenticated clients — handled by the
-- signup flow and Stripe webhook handlers using the service role.
create policy "organizations_select_own"
  on public.organizations
  for select
  to authenticated
  using (id = public.org_id());

create policy "organizations_update_own"
  on public.organizations
  for update
  to authenticated
  using      (id = public.org_id())
  with check (id = public.org_id());

-- Users: members can read every user in their org; each user can edit only
-- their own profile. Role changes and invites go through server-side flows
-- using the service role.
create policy "users_select_same_org"
  on public.users
  for select
  to authenticated
  using (organization_id = public.org_id());

create policy "users_update_self"
  on public.users
  for update
  to authenticated
  using      (id = auth.uid())
  with check (id = auth.uid());

-- Auto-provision a fresh organization + owner profile when a new auth user
-- signs up. Invite-based joins (which skip the organizations insert and
-- reuse an existing org_id) are a later feature; this trigger covers the
-- self-signup path only.
--
-- SECURITY DEFINER runs as the function owner (postgres), bypassing RLS on
-- both tables so the inserts succeed before the new user has a session.
-- search_path locked to '' — all objects are schema-qualified.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name, slug, trial_ends_at)
  values (
    new_org_id,
    new.email,
    'org-' || substring(replace(new_org_id::text, '-', '') from 1 for 12),
    now() + interval '14 days'
  );

  insert into public.users (id, organization_id, email, full_name, role)
  values (
    new.id,
    new_org_id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    'owner'
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
