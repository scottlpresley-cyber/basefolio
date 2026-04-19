"use client";

// Inline owner select. Empty value ("Unassigned") maps to null — the
// PATCH schema treats that as an explicit unset, not an omit.

import { useEffect, useRef } from "react";
import { formInputClass } from "@/components/forms/FormField";
import { displayName } from "@/lib/users/display";
import type { OrgMember } from "@/lib/users/queries";
import { EditableField } from "@/components/projects/editors/EditableField";

export function OwnerEditor({
  value,
  ownerName,
  members,
  onSave,
}: {
  value: string | null;
  ownerName: string | null;
  members: OrgMember[];
  onSave: (next: string | null) => Promise<void>;
}) {
  return (
    <EditableField<string>
      value={value ?? ""}
      onSave={(next) => onSave(next === "" ? null : next)}
      ariaLabel="owner"
      renderDisplay={() =>
        ownerName?.trim() ? (
          <span className="text-sm text-text-primary">{ownerName}</span>
        ) : (
          <span className="text-sm text-text-disabled">Assign owner</span>
        )
      }
      renderEditor={({ value, onChange, onCommit, onCancel, id, disabled }) => (
        <OwnerSelect
          id={id}
          value={value}
          members={members}
          onChange={(v) => {
            // Select commits on choose — no separate Save step feels
            // right for a one-click interaction. Propagate + commit
            // in the same turn.
            onChange(v);
            requestAnimationFrame(onCommit);
          }}
          onCancel={onCancel}
          disabled={disabled}
        />
      )}
    />
  );
}

function OwnerSelect({
  id,
  value,
  members,
  onChange,
  onCancel,
  disabled,
}: {
  id: string;
  value: string;
  members: OrgMember[];
  onChange: (v: string) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <select
      id={id}
      ref={ref}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className={`${formInputClass} text-sm`}
    >
      <option value="">Unassigned</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {displayName(m)}
        </option>
      ))}
    </select>
  );
}
