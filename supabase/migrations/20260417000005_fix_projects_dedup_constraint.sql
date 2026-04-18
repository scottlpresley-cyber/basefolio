-- Sprint 1 follow-up: the original UNIQUE(organization_id, external_id)
-- index blocked legitimate cross-report re-imports. A project group named
-- "Customer Portal" in last week's report is the same logical project as
-- "Customer Portal" in this week's report — collisions across reports are
-- expected and must be allowed.
--
-- New dedup semantic:
--   * Within a single source_report_id: (org, external_id) unique.
--     Prevents double-import of the same report.
--   * Manually created (source_report_id IS NULL): (org, external_id) unique.
--     Prevents a user creating two manual "Customer Portal" entries.
--   * Across different source_report_ids: collisions allowed.

drop index if exists public.projects_org_external_id_idx;

create unique index projects_org_external_per_report_uidx
  on public.projects (organization_id, source_report_id, external_id)
  where source_report_id is not null and external_id is not null;

create unique index projects_org_external_manual_uidx
  on public.projects (organization_id, external_id)
  where source_report_id is null and external_id is not null;
