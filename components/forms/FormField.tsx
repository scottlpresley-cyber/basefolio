// Label + input wrapper for forms. Label styling follows Pattern 6
// (uppercase tracking-wide, muted). Error slot renders in health-red
// under the control. Children render inside a block so callers can
// drop in <input>, <textarea>, <select>, or custom controls.
//
// Intentionally agnostic — no input element is owned here, so the
// HealthToggle and the native text input can both live inside a
// FormField with no special-casing.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("block", className)}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-text-muted uppercase tracking-wide block mb-2"
      >
        {label}
        {required ? null : (
          <span className="ml-1 font-normal normal-case tracking-normal text-text-disabled">
            (optional)
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-health-red" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

// Shared input class for text, date, select fields. Exported so other
// form components can match the visual without duplicating the
// focus-ring + border rules.
export const formInputClass =
  "w-full px-3 py-2 text-sm text-text-primary bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal placeholder:text-text-disabled disabled:opacity-50 disabled:cursor-not-allowed";
