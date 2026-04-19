// Pure-presentation list of status update cards. Receives the
// updates array as a prop — the parent ProjectUpdatesSection wrapper
// owns the state so optimistic prepends after a save flow through
// without a full RSC refresh.

"use client";

import { MessageSquare } from "lucide-react";
import { UpdateCard } from "@/components/projects/UpdateCard";
import type { ProjectUpdate } from "@/types/app.types";

export function StatusUpdatesFeed({ updates }: { updates: ProjectUpdate[] }) {
  if (updates.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-md">
        <div className="flex flex-col items-center justify-center py-12 px-8 text-center">
          <div className="w-12 h-12 rounded-lg bg-gray-light flex items-center justify-center mb-4">
            <MessageSquare className="w-6 h-6 text-text-disabled" aria-hidden />
          </div>
          <h3 className="text-base font-semibold text-text-primary mb-1">
            No updates yet
          </h3>
          <p className="text-sm text-text-muted max-w-sm">
            Status updates you post will appear here in reverse chronological
            order.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Status updates" className="space-y-3">
      <h2 className="text-sm font-semibold text-text-primary">Updates</h2>
      <div className="space-y-3">
        {updates.map((u) => (
          <UpdateCard key={u.id} update={u} />
        ))}
      </div>
    </section>
  );
}
