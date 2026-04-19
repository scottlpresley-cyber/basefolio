"use client";

// Client wrapper that owns the updates list state for the project
// detail page. The server component fetches the initial array via
// listProjectUpdates and passes it in; from then on, every save
// flows through onSaved -> setUpdates and prepends without a full
// RSC refresh.
//
// formKey bumps on every save -> StatusUpdateForm remounts ->
// useForm state, the optional-fields disclosure, and the summary
// autofocus all reset cleanly. Cheaper than threading controlled
// `open` props through the disclosure primitive.
//
// defaultHealth carries forward: the most recent update's health
// becomes the seed for the next form. Falls back to 'green' when
// the feed is empty or the stored value is somehow unrecognized.

import { useState } from "react";
import { StatusUpdateForm } from "@/components/projects/StatusUpdateForm";
import { StatusUpdatesFeed } from "@/components/projects/StatusUpdatesFeed";
import type { ProjectHealth, ProjectUpdate } from "@/types/app.types";

function isHealth(value: string | null | undefined): value is ProjectHealth {
  return value === "green" || value === "yellow" || value === "red";
}

export function ProjectUpdatesSection({
  projectId,
  initialUpdates,
}: {
  projectId: string;
  initialUpdates: ProjectUpdate[];
}) {
  const [updates, setUpdates] = useState<ProjectUpdate[]>(initialUpdates);
  const [formKey, setFormKey] = useState(0);

  const latestHealth = updates[0]?.health;
  const defaultHealth: ProjectHealth = isHealth(latestHealth) ? latestHealth : "green";

  const handleSaved = (created: ProjectUpdate) => {
    setUpdates((prev) => [created, ...prev]);
    setFormKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      <StatusUpdateForm
        key={formKey}
        projectId={projectId}
        defaultHealth={defaultHealth}
        onSaved={handleSaved}
      />
      <StatusUpdatesFeed updates={updates} />
    </div>
  );
}
