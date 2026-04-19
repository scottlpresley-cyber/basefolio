"use client";

// Minimal popover wrapper. The only place this is used (HealthEditor)
// needs exactly: trigger element that toggles the panel, panel
// positioned below + right-aligned to the trigger, close on outside-
// click, close on Escape. Radix's Popover does all this plus focus
// trap + portal + a11y tree — overkill for 3 buttons.
//
// Intentionally unexported from the projects/ barrel: if a second
// consumer shows up with different positioning needs, reach for
// radix-ui/react-popover at that point instead of growing this.

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  panelClassName,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  panelClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onOpenChange(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {trigger}
      {open ? (
        <div
          role="dialog"
          className={cn(
            "absolute top-full mt-2 left-0 z-20 bg-surface border border-border rounded-md shadow-md p-1 min-w-[10rem]",
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
