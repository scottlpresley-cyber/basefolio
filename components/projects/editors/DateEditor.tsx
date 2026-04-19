"use client";

// Inline date editor. Empty input means "unset" (null). Cross-field
// validation (target_end >= start) runs locally before the network
// call — the caller passes `pairWith` so we can compare against the
// other bound date without a round-trip. The PATCH handler runs a
// server-side cross-check too (defense in depth for the case where
// only one date is in the patch body).

import { useEffect, useRef, useState } from "react";
import { formInputClass } from "@/components/forms/FormField";
import { EditableField } from "@/components/projects/editors/EditableField";

type PairConstraint =
  | { kind: "must_be_on_or_after"; value: string | null }
  | { kind: "must_be_on_or_before"; value: string | null };

export function DateEditor({
  value,
  onSave,
  placeholder,
  constraint,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  placeholder: string;
  constraint?: PairConstraint;
}) {
  return (
    <EditableField<string>
      value={value ?? ""}
      onSave={(next) => onSave(next === "" ? null : next)}
      ariaLabel="date"
      renderDisplay={(v) =>
        v ? (
          <span className="text-sm text-text-primary">
            {formatDateForDisplay(v)}
          </span>
        ) : (
          <span className="text-sm text-text-disabled">{placeholder}</span>
        )
      }
      renderEditor={({ value, onChange, onCommit, onCancel, id, disabled }) => (
        <DateInput
          id={id}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          onCancel={onCancel}
          disabled={disabled}
          constraint={constraint}
        />
      )}
    />
  );
}

function DateInput({
  id,
  value,
  onChange,
  onCommit,
  onCancel,
  disabled,
  constraint,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  disabled: boolean;
  constraint?: PairConstraint;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function validate(next: string): string | null {
    if (!next || !constraint?.value) return null;
    if (constraint.kind === "must_be_on_or_after" && next < constraint.value) {
      return "Target end date must be on or after the start date.";
    }
    if (constraint.kind === "must_be_on_or_before" && next > constraint.value) {
      return "Start date must be on or before the target end date.";
    }
    return null;
  }

  function tryCommit() {
    const msg = validate(value);
    if (msg) {
      setError(msg);
      return;
    }
    onCommit();
  }

  return (
    <div>
      <input
        id={id}
        ref={ref}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setError(null);
        }}
        onBlur={tryCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            tryCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className={`${formInputClass} text-sm`}
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs text-health-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function formatDateForDisplay(iso: string): string {
  // Intentionally simple — avoids importing the full formatDate util
  // for this one call site. Date-only strings don't need timezone
  // correction in this direction (we're formatting for display in
  // the sidebar, where the detail page already uses the same style).
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
