// Right-rail metadata card on the project detail page. Vertical stack
// of label/value pairs; labels use the Pattern 6 uppercase-tracking
// treatment so the sidebar reads as structured metadata rather than
// body copy.

import type { ReactNode } from "react";
import { formatDate } from "@/lib/utils/date";
import { formatSource } from "@/lib/projects/sources";
import type { Project } from "@/types/app.types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className="text-sm text-text-primary break-words">{children}</p>
    </div>
  );
}

export function ProjectDetailSidebar({ project }: { project: Project }) {
  const ownerLabel = project.owner_name?.trim() || "Unassigned";

  return (
    <aside className="bg-surface border border-border rounded-md p-5 space-y-5">
      <h2 className="text-sm font-semibold text-text-primary">Details</h2>

      <Field label="Owner">{ownerLabel}</Field>
      <Field label="Phase">{project.phase?.trim() || "—"}</Field>
      <Field label="Start date">{formatDate(project.start_date, "short")}</Field>
      <Field label="Target end date">
        {formatDate(project.target_end_date, "short")}
      </Field>
      <Field label="Last update">
        {formatDate(project.last_update_at ?? null, "relative")}
      </Field>
      <Field label="Source">{formatSource(project.source)}</Field>
    </aside>
  );
}
