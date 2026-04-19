// Pattern 3 health indicators: badge (default) for cards and tables,
// dot (compact) for dense list rows. Same color mapping across both.

import { cn } from "@/lib/utils";
import type { ProjectHealth } from "@/types/app.types";

type HealthConfig = {
  label: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
};

const HEALTH_CONFIG: Record<ProjectHealth, HealthConfig> = {
  green: {
    label: "On Track",
    bg: "bg-health-green-bg",
    text: "text-health-green",
    border: "border-health-green/20",
    dot: "bg-health-green",
  },
  yellow: {
    label: "At Risk",
    bg: "bg-health-yellow-bg",
    text: "text-health-yellow",
    border: "border-health-yellow/20",
    dot: "bg-health-yellow",
  },
  red: {
    label: "Off Track",
    bg: "bg-health-red-bg",
    text: "text-health-red",
    border: "border-health-red/20",
    dot: "bg-health-red",
  },
};

export function HealthBadge({
  status,
  className,
}: {
  status: ProjectHealth;
  className?: string;
}) {
  const cfg = HEALTH_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border",
        cfg.bg,
        cfg.text,
        cfg.border,
        className,
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
}

export function HealthDot({
  status,
  className,
}: {
  status: ProjectHealth;
  className?: string;
}) {
  const cfg = HEALTH_CONFIG[status];
  return (
    <span
      aria-label={cfg.label}
      className={cn("w-2.5 h-2.5 rounded-full shrink-0", cfg.dot, className)}
    />
  );
}

// "Full pill" variant from Pattern 3 — larger than the table badge,
// rendered once at the top of the project detail page.
export function HealthPill({
  status,
  className,
}: {
  status: ProjectHealth;
  className?: string;
}) {
  const cfg = HEALTH_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium border",
        cfg.bg,
        cfg.text,
        cfg.border,
        className,
      )}
    >
      <span className="w-2 h-2 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
}
