// Project-detail metadata header: full health pill, phase, non-active
// status chip, owner, and a disabled Edit button (inline editing is
// a Prompt 8 deliverable).
//
// The project name is rendered by PageShell — don't duplicate it here.

import { Button } from "@/components/ui/button";
import { HealthPill } from "@/components/projects/HealthBadge";
import type { Project, ProjectHealth, ProjectStatus } from "@/types/app.types";

function isHealth(value: string): value is ProjectHealth {
  return value === "green" || value === "yellow" || value === "red";
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  canceled: "Canceled",
};

function Separator() {
  // Muted middot — Pattern 4 voice: clean separators, no pipes.
  return <span className="text-text-disabled" aria-hidden>·</span>;
}

export function ProjectDetailHeader({ project }: { project: Project }) {
  const health: ProjectHealth = isHealth(project.health) ? project.health : "green";
  const statusLabel = STATUS_LABELS[project.status as ProjectStatus] ?? null;
  const showStatusChip = project.status && project.status !== "active" && statusLabel;

  const ownerLabel = project.owner_name?.trim() || "Unassigned";

  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        <HealthPill status={health} />

        {project.phase ? (
          <>
            <Separator />
            <span className="text-sm text-text-secondary">{project.phase}</span>
          </>
        ) : null}

        {showStatusChip ? (
          <>
            <Separator />
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-gray-light text-text-secondary border border-border">
              {statusLabel}
            </span>
          </>
        ) : null}

        <Separator />
        <span className="text-sm text-text-secondary truncate">{ownerLabel}</span>
      </div>

      <Button variant="outline" size="default" disabled title="Coming soon">
        Edit
      </Button>
    </div>
  );
}
