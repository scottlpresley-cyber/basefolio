-- Sprint 1 test-data cleanup.
--
-- Removes the curl-test identity (route-test@basefolio.test), its
-- auto-provisioned organization, and everything that cascades from it:
-- public.users, public.projects, public.status_reports.
--
-- Idempotent: safe to re-run. Returns rows from each DELETE so the
-- operator can confirm what went.
--
-- NOTE: storage objects under the test org's prefix in the
-- status-draft-uploads bucket are NOT removed by this script. Supabase
-- blocks raw DELETE on storage.objects (storage.protect_delete trigger);
-- the admin SDK must be used. Run before or after this script:
--   node --env-file=.env.local -e "…see README of deploy runbook…"

-- Report what's about to go (runs before any DELETE so the counts are
-- useful even if subsequent steps bail).
select
  (select count(*) from public.organizations o
    join public.users u on u.organization_id = o.id
    where u.email = 'route-test@basefolio.test') as organizations,
  (select count(*) from public.users
    where email = 'route-test@basefolio.test') as app_users,
  (select count(*) from public.projects p
    join public.users u on u.organization_id = p.organization_id
    where u.email = 'route-test@basefolio.test') as projects,
  (select count(*) from public.status_reports r
    join public.users u on u.organization_id = r.organization_id
    where u.email = 'route-test@basefolio.test') as status_reports,
  (select count(*) from auth.users
    where email = 'route-test@basefolio.test') as auth_users;

-- Cascade-delete the organization. Drops public.users, projects, and
-- status_reports for that org via ON DELETE CASCADE.
delete from public.organizations
  where id in (
    select organization_id from public.users
    where email = 'route-test@basefolio.test'
  )
  returning id, name, slug;

-- Remove the auth identity. Cascade to public.users already ran via the
-- org delete above; auth.users has no FK to organizations, so it's still
-- here and needs its own DELETE.
delete from auth.users
  where email = 'route-test@basefolio.test'
  returning id, email;
