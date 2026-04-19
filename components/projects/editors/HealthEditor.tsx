"use client";

// Clicking the health pill opens a small popover with all three
// choices — the choice IS the commit, no separate Save step. Uses
// our minimal Popover wrapper; see components/projects/editors/
// Popover.tsx for why we didn't reach for radix-ui.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { HealthPill } from "@/components/projects/HealthBadge";
import { Popover } from "@/components/projects/editors/Popover";
import type { ProjectHealth } from "@/types/app.types";

const OPTIONS: {
  value: ProjectHealth;
  label: string;
  dot: string;
  activeBg: string;
  activeText: string;
}[] = [
  {
    value: "green",
    label: "On Track",
    dot: "bg-health-green",
    activeBg: "bg-health-green-bg",
    activeText: "text-health-green",
  },
  {
    value: "yellow",
    label: "At Risk",
    dot: "bg-health-yellow",
    activeBg: "bg-health-yellow-bg",
    activeText: "text-health-yellow",
  },
  {
    value: "red",
    label: "Off Track",
    dot: "bg-health-red",
    activeBg: "bg-health-red-bg",
    activeText: "text-health-red",
  },
];

export function HealthEditor({
  value,
  onSave,
}: {
  value: ProjectHealth;
  onSave: (next: ProjectHealth) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function choose(next: ProjectHealth) {
    if (saving) return;
    setOpen(false);
    if (next === value) return;
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={saving}
          aria-label="Change health"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 transition-opacity",
            saving ? "opacity-60" : "hover:opacity-80 cursor-pointer",
          )}
        >
          <HealthPill status={value} />
        </button>
      }
    >
      <ul role="menu" className="py-1">
        {OPTIONS.map((opt) => (
          <li key={opt.value}>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(opt.value)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm",
                value === opt.value
                  ? cn(opt.activeBg, opt.activeText)
                  : "text-text-primary hover:bg-surface-hover",
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", opt.dot)} />
              {opt.label}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
