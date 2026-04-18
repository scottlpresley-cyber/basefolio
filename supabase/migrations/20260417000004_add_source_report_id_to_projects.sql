-- Sprint 1: back-link projects to the status_report that created them
-- via "Import to Basefolio". Used to dedup re-imports of the same report
-- (same report_id + same external_id = already imported).

alter table public.projects
  add column source_report_id uuid references public.status_reports(id) on delete set null;

-- Partial index for the dedup lookup inside the import route:
--   select external_id from projects where organization_id = ? and source_report_id = ?
create index idx_projects_org_report_external
  on public.projects (organization_id, source_report_id, external_id)
  where source_report_id is not null;
