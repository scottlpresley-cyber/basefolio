// Collapsible "optional fields" disclosure matching Pattern 6. Uses a
// native <details>/<summary> pair — no client-side state needed. The
// chevron rotates when open via the `group-open:rotate-90` utility.
//
// Reusable: both the Add Project form and the Prompt 7 status update
// form render their optional stack inside one of these.

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function OptionalFieldsDisclosure({
  label,
  defaultOpen,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary flex items-center gap-1 list-none select-none">
        <ChevronRight
          className="w-3.5 h-3.5 transition-transform group-open:rotate-90"
          aria-hidden
        />
        {label}
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}
