-- Sprint 1 debug-data cleanup.
--
-- Scott ran the Status Draft end-to-end flow four times while we debugged
-- the import 401 and the toast-lifecycle bug. Each successful run inserted
-- 5 projects (20 total) and the corresponding status_reports rows. None
-- of it is user-meaningful content — clear it out before Sprint 2 lands.
--
-- The two status_reports that were generated but never successfully
-- imported (01:53 and 18:44 UTC on 2026-04-18) are NOT targets: they
-- have no projects attached, so they are not "associated with an import."
-- They represent earlier verification runs and stay.
--
-- Idempotent: re-running drops zero rows on the second invocation.

-- Counts before the delete, so the operator can compare.
select
  (select count(*) from public.projects) as projects_before,
  (select count(*) from public.status_reports) as status_reports_before;

-- Step 1: delete projects. source_report_id on projects FK's status_reports
-- with ON DELETE SET NULL, so we MUST drop the projects before the reports
-- — otherwise the FK would silently null out rather than cascade.
delete from public.projects
returning id, name, source_report_id;

-- Step 2: delete the four status_reports that the 20 debug project rows
-- were attached to. IDs captured before the DELETE above — listed here
-- verbatim so the cleanup stays auditable.
delete from public.status_reports
  where id in (
    'c92d2485-b6d9-4cd6-bf46-35aeec2396af', -- 2026-04-18 19:06:13 UTC
    '4b885849-c671-4ce2-aaaa-b527ecac39c6', -- 2026-04-18 19:08:26 UTC
    'f1db5326-0036-4c8a-8ee8-f691561933e3', -- 2026-04-18 19:10:16 UTC
    'baa9096c-baea-4551-ad57-81e307d44af5'  -- 2026-04-18 19:14:25 UTC
  )
  returning id, source_file_name, created_at;

-- Counts after.
select
  (select count(*) from public.projects) as projects_after,
  (select count(*) from public.status_reports) as status_reports_after;
