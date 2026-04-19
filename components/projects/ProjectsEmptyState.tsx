// Pattern 5 empty state for /projects when the org has no projects.
// Copy follows ui-context.md §6 (explain value, not absence).

import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProjectsEmptyState() {
  return (
    <div className="bg-surface border border-border rounded-md">
      <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
        <div className="w-12 h-12 rounded-lg bg-gray-light flex items-center justify-center mb-4">
          <FolderKanban className="w-6 h-6 text-text-disabled" aria-hidden />
        </div>
        <h3 className="text-base font-semibold text-text-primary mb-1">
          Your portfolio is empty
        </h3>
        <p className="text-sm text-text-muted mb-6 max-w-xs">
          Add your first project to start tracking health and progress, or import
          from your last Status Draft.
        </p>
        <div className="flex items-center gap-3">
          <Button asChild variant="default" size="default">
            <Link href="/projects/new">Add Project</Link>
          </Button>
          <Button asChild variant="outline" size="default">
            <Link href="/status-draft">Import from Status Draft</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
