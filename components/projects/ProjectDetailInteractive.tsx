"use client";

// Owns every piece of interactive state on the project detail page:
//   - project (for inline edits on header + sidebar)
//   - auditEntries (for the Activity panel)
// Plus it hosts ProjectUpdatesSection (Prompt 6B) as a sibling in
// the layout.
//
// Why one wrapper instead of two: inline edits in the header and the
// sidebar both mutate the same Project object — they need to share
// one state cell, and they live in different grid columns. A single
// client boundary that renders the whole grid is the least-surprising
// way to share that state without Context or Portals.
//
// Non-health edits call updateProject (200 with { project }).
// Health edits call updateProjectHealth (200 with { project,
// auditEntry }). The PATCH handler branches; the client doesn't
// care — it just prepends auditEntry when the server returns one.

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils/date";
import { formatSource } from "@/lib/projects/sources";
import {
  ProjectDetailLayout,
  ProjectDetailMain,
  ProjectDetailSidebarCol,
} from "@/components/projects/ProjectDetailLayout";
import { ProjectUpdatesSection } from "@/components/projects/ProjectUpdatesSection";
import { ActivityPanel } from "@/components/projects/ActivityPanel";
import { HealthEditor } from "@/components/projects/editors/HealthEditor";
import { PhaseEditor } from "@/components/projects/editors/PhaseEditor";
import { OwnerEditor } from "@/components/projects/editors/OwnerEditor";
import { DateEditor } from "@/components/projects/editors/DateEditor";
import { displayName } from "@/lib/users/display";
import type { OrgMember } from "@/lib/users/queries";
import type {
  Project,
  ProjectAuditEntry,
  ProjectHealth,
  ProjectStatus,
  ProjectUpdate,
} from "@/types/app.types";

type ProjectPatchBody = {
  health?: ProjectHealth;
  phase?: string | null;
  owner_id?: string | null;
  start_date?: string | null;
  target_end_date?: string | null;
};

type PatchApiResponse = {
  project?: Project;
  auditEntry?: ProjectAuditEntry | null;
  error?: string;
  code?: string;
  fields?: Record<string, string>;
};

function isHealth(v: string | null | undefined): v is ProjectHealth {
  return v === "green" || v === "yellow" || v === "red";
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  canceled: "Canceled",
};

function Separator() {
  return (
    <span className="text-text-disabled" aria-hidden>
      ·
    </span>
  );
}

function SidebarField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
        {label}
      </p>
      <div className="text-sm text-text-primary break-words">{children}</div>
    </div>
  );
}

export function ProjectDetailInteractive({
  initialProject,
  initialAuditEntries,
  initialUpdates,
  members,
}: {
  initialProject: Project;
  initialAuditEntries: ProjectAuditEntry[];
  initialUpdates: ProjectUpdate[];
  members: OrgMember[];
}) {
  const { toast } = useToast();
  const [project, setProject] = useState<Project>(initialProject);
  const [auditEntries, setAuditEntries] =
    useState<ProjectAuditEntry[]>(initialAuditEntries);

  async function patch(overlay: ProjectPatchBody): Promise<void> {
    const previous = project;

    // Derive owner_name optimistically so the UI lines up with the
    // rest of the layout (which reads project.owner_name directly).
    let optimisticOwnerName = project.owner_name ?? null;
    if ("owner_id" in overlay) {
      if (!overlay.owner_id) optimisticOwnerName = null;
      else {
        const m = members.find((x) => x.id === overlay.owner_id);
        optimisticOwnerName = m ? displayName(m) : null;
      }
    }
    const optimistic: Project = {
      ...project,
      ...overlay,
      owner_name: optimisticOwnerName,
    };
    setProject(optimistic);

    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(overlay),
    });

    let body: PatchApiResponse = {};
    try {
      body = (await response.json()) as PatchApiResponse;
    } catch {
      // Non-JSON — generic error path.
    }

    if (response.status === 200 && body.project) {
      // Reconcile with server truth, preserve derived fields (the
      // PATCH response is the raw row; it doesn't carry
      // owner_name / last_update_at).
      setProject({
        ...body.project,
        owner_name: optimisticOwnerName,
        last_update_at: project.last_update_at ?? null,
      });
      if (body.auditEntry) {
        setAuditEntries((prev) => [body.auditEntry!, ...prev].slice(0, 5));
      }
      toast("Saved.");
      return;
    }

    // Failure — revert and surface a message.
    setProject(previous);
    if (response.status === 400 && body.fields) {
      const firstMessage = Object.values(body.fields)[0];
      toast(firstMessage ?? body.error ?? "Some fields need attention.");
      throw new Error(firstMessage ?? body.error ?? "Validation failed");
    }
    if (response.status === 401) {
      window.location.href = "/login";
      throw new Error("Unauthenticated");
    }
    toast(body.error ?? "We couldn't save that change. Try again in a moment.");
    throw new Error(body.error ?? "Save failed");
  }

  const health: ProjectHealth = isHealth(project.health) ? project.health : "green";
  const statusLabel = STATUS_LABELS[project.status as ProjectStatus] ?? null;
  const showStatusChip =
    project.status && project.status !== "active" && statusLabel;

  return (
    <ProjectDetailLayout>
      <ProjectDetailMain>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <HealthEditor
              value={health}
              onSave={(next) => patch({ health: next })}
            />

            <Separator />
            <PhaseEditor
              value={project.phase ?? null}
              onSave={(next) => patch({ phase: next })}
            />

            {showStatusChip ? (
              <>
                <Separator />
                <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-gray-light text-text-secondary border border-border">
                  {statusLabel}
                </span>
              </>
            ) : null}

            <Separator />
            <OwnerEditor
              value={project.owner_id ?? null}
              ownerName={project.owner_name ?? null}
              members={members}
              onSave={(next) => patch({ owner_id: next })}
            />
          </div>
        </div>

        <ProjectUpdatesSection
          projectId={project.id}
          initialUpdates={initialUpdates}
        />
      </ProjectDetailMain>

      <ProjectDetailSidebarCol>
        <aside className="bg-surface border border-border rounded-md p-5 space-y-5">
          <h2 className="text-sm font-semibold text-text-primary">Details</h2>

          <SidebarField label="Owner">
            <OwnerEditor
              value={project.owner_id ?? null}
              ownerName={project.owner_name ?? null}
              members={members}
              onSave={(next) => patch({ owner_id: next })}
            />
          </SidebarField>

          <SidebarField label="Phase">
            <PhaseEditor
              value={project.phase ?? null}
              onSave={(next) => patch({ phase: next })}
            />
          </SidebarField>

          <SidebarField label="Start date">
            <DateEditor
              value={project.start_date ?? null}
              placeholder="Set start date"
              constraint={
                project.target_end_date
                  ? {
                      kind: "must_be_on_or_before",
                      value: project.target_end_date,
                    }
                  : undefined
              }
              onSave={(next) => patch({ start_date: next })}
            />
          </SidebarField>

          <SidebarField label="Target end date">
            <DateEditor
              value={project.target_end_date ?? null}
              placeholder="Set target end date"
              constraint={
                project.start_date
                  ? {
                      kind: "must_be_on_or_after",
                      value: project.start_date,
                    }
                  : undefined
              }
              onSave={(next) => patch({ target_end_date: next })}
            />
          </SidebarField>

          <SidebarField label="Last update">
            {formatDate(project.last_update_at ?? null, "relative")}
          </SidebarField>

          <SidebarField label="Source">
            {formatSource(project.source)}
          </SidebarField>
        </aside>

        <ActivityPanel entries={auditEntries} />
      </ProjectDetailSidebarCol>
    </ProjectDetailLayout>
  );
}
