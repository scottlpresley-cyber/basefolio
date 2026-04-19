"use client";

// Reusable inline health toggle — three buttons with dot + label, per
// ui-context.md Pattern 6. Controlled: caller owns the value and
// onChange. Shared by the Add Project form here and the Prompt 7
// status update form.

import { cn } from "@/lib/utils";
import type { ProjectHealth } from "@/types/app.types";

const OPTIONS: {
  value: ProjectHealth;
  label: string;
  dot: string;
  activeBg: string;
  activeText: string;
  activeBorder: string;
}[] = [
  {
    value: "green",
    label: "On Track",
    dot: "bg-health-green",
    activeBg: "bg-health-green-bg",
    activeText: "text-health-green",
    activeBorder: "border-health-green/40",
  },
  {
    value: "yellow",
    label: "At Risk",
    dot: "bg-health-yellow",
    activeBg: "bg-health-yellow-bg",
    activeText: "text-health-yellow",
    activeBorder: "border-health-yellow/40",
  },
  {
    value: "red",
    label: "Off Track",
    dot: "bg-health-red",
    activeBg: "bg-health-red-bg",
    activeText: "text-health-red",
    activeBorder: "border-health-red/40",
  },
];

export function HealthToggle({
  value,
  onChange,
  disabled,
  name,
}: {
  value: ProjectHealth;
  onChange: (next: ProjectHealth) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Overall health"
      className="flex gap-2"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-all",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              active
                ? cn(opt.activeBg, opt.activeText, opt.activeBorder)
                : "bg-surface text-text-secondary border-border hover:bg-surface-hover",
            )}
            data-name={name}
          >
            <span className={cn("w-2 h-2 rounded-full", opt.dot)} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
