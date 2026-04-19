// Two-column detail-page grid per ui-context.md §4: 8-col main +
// 4-col sidebar on desktop, single-column stack on mobile. Uses CSS
// Grid (`grid-cols-12`) rather than flex so the Sprint 3 dashboard
// layout can reuse the same token vocabulary.

import type { ReactNode } from "react";

export function ProjectDetailLayout({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">{children}</div>;
}

export function ProjectDetailMain({ children }: { children: ReactNode }) {
  return <div className="lg:col-span-8 min-w-0 space-y-6">{children}</div>;
}

export function ProjectDetailSidebarCol({ children }: { children: ReactNode }) {
  return <div className="lg:col-span-4 min-w-0 space-y-6">{children}</div>;
}
