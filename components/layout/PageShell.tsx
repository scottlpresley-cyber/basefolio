// Wrapper for authenticated pages. Consistent padding, max width, and
// a header row that pairs a title with optional actions (add buttons,
// filters, etc). Reusable across dashboard, projects, intake, reports.
//
// Matches the existing status-draft page's p-6 / max-w-7xl shell so
// typography and gutters line up once every app page adopts it.

import type { ReactNode } from "react";

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
          {description ? (
            <p className="text-sm text-text-muted mt-1 max-w-2xl">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
