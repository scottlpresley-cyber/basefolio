"use client";

// Last-N health-change entries from the audit log. Parent wrapper
// owns the list so that optimistic prepends on save arrive without
// a refetch. Renders pure from the `entries` prop.
//
// Entries that aren't 'project.health_changed' are formatted with a
// safe generic fallback — room for future action types (owner change
// audits etc.) without breaking.

import { HealthDot } from "@/components/projects/HealthBadge";
import { formatDate } from "@/lib/utils/date";
import type { ProjectAuditEntry, ProjectHealth } from "@/types/app.types";

function isHealth(value: unknown): value is ProjectHealth {
  return value === "green" || value === "yellow" || value === "red";
}

function HEALTH_LABEL(h: ProjectHealth): string {
  return h === "green" ? "Green" : h === "yellow" ? "Yellow" : "Red";
}

function EntryBody({ entry }: { entry: ProjectAuditEntry }) {
  if (entry.action === "project.health_changed") {
    const oldH = entry.old_value?.health;
    const newH = entry.new_value?.health;
    return (
      <p className="text-sm text-text-primary">
        Health changed
        {isHealth(oldH) ? (
          <>
            {" "}
            <HealthDot status={oldH} className="inline-block align-middle" />{" "}
            <span className="align-middle">{HEALTH_LABEL(oldH)}</span>
          </>
        ) : null}
        {" → "}
        {isHealth(newH) ? (
          <>
            <HealthDot status={newH} className="inline-block align-middle" />{" "}
            <span className="align-middle">{HEALTH_LABEL(newH)}</span>
          </>
        ) : null}
      </p>
    );
  }
  // Fallback — keeps the panel readable if we start logging other
  // action types before this component learns to format them.
  return <p className="text-sm text-text-primary">{entry.action}</p>;
}

export function ActivityPanel({ entries }: { entries: ProjectAuditEntry[] }) {
  return (
    <aside className="bg-surface border border-border rounded-md p-5 space-y-3">
      <h2 className="text-sm font-semibold text-text-primary">Activity</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">No health changes recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry, i) => (
            <li
              key={entry.id}
              className={
                i === 0
                  ? ""
                  : "pt-3 border-t border-border"
              }
            >
              <EntryBody entry={entry} />
              <p className="mt-0.5 text-xs text-text-muted">
                {entry.actor_name ? `by ${entry.actor_name}, ` : null}
                {formatDate(entry.created_at, "relative")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
