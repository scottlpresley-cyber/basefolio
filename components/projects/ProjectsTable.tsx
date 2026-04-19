// Pattern 4 data table for the projects list.
// CSS Grid, not <table>. Each row is a Link so the whole row is
// clickable without a client component.
//
// Columns: Project (name + phase) | Health | Owner | Due | actions
// placeholder (40px, empty — row menu lands in Prompt 8).

import Link from "next/link";
import { HealthBadge } from "@/components/projects/HealthBadge";
import type { Project, ProjectHealth } from "@/types/app.types";

const GRID = "grid-cols-[2fr_1fr_1fr_1fr_40px]";

function formatDueDate(iso: string | null): string {
  if (!iso) return "—";
  // Dates come back as 'YYYY-MM-DD'. Render in the viewer's locale
  // as 'Apr 30, 2026'-style short form.
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isHealth(value: string): value is ProjectHealth {
  return value === "green" || value === "yellow" || value === "red";
}

export function ProjectsTable({ projects }: { projects: Project[] }) {
  return (
    <div className="bg-surface border border-border rounded-md overflow-hidden">
      <div
        className={`grid ${GRID} px-4 py-2 bg-gray-light border-b border-border`}
      >
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Project
        </span>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Health
        </span>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Owner
        </span>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Due
        </span>
        <span aria-hidden />
      </div>

      {projects.map((project) => {
        const health: ProjectHealth = isHealth(project.health)
          ? project.health
          : "green";
        const ownerLabel = project.owner_name?.trim() ? project.owner_name : "—";
        return (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className={`grid ${GRID} items-center px-4 py-3 border-b border-border last:border-0 hover:bg-surface-hover transition-colors`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {project.name}
              </p>
              <p className="text-xs text-text-muted truncate">
                {project.phase ?? "—"}
              </p>
            </div>
            <div>
              <HealthBadge status={health} />
            </div>
            <span className="text-sm text-text-secondary truncate">
              {ownerLabel}
            </span>
            <span className="text-sm text-text-muted">
              {formatDueDate(project.target_end_date)}
            </span>
            <span aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
