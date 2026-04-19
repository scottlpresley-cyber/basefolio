"use client";

// Inline text editor for project.phase. Empty string is a legitimate
// user choice — the PATCH schema normalizes it to null (unset).

import { useEffect, useRef } from "react";
import { formInputClass } from "@/components/forms/FormField";
import { EditableField } from "@/components/projects/editors/EditableField";

export function PhaseEditor({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
}) {
  return (
    <EditableField<string>
      value={value ?? ""}
      onSave={(next) => onSave(next.trim() === "" ? null : next.trim())}
      ariaLabel="phase"
      renderDisplay={(v) =>
        v.trim() ? (
          <span className="text-sm text-text-primary">{v}</span>
        ) : (
          <span className="text-sm text-text-disabled">Add phase</span>
        )
      }
      renderEditor={({ value, onChange, onCommit, onCancel, id, disabled }) => (
        <PhaseInput
          id={id}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          onCancel={onCancel}
          disabled={disabled}
        />
      )}
    />
  );
}

function PhaseInput({
  id,
  value,
  onChange,
  onCommit,
  onCancel,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      id={id}
      ref={ref}
      type="text"
      value={value}
      maxLength={100}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      placeholder="Planning, Execution, Closing..."
      className={`${formInputClass} text-sm`}
    />
  );
}
