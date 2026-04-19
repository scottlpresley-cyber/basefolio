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
      renderEditor={({ value, onCommit, onCancel, id, disabled }) => (
        <OwnerSelect
          id={id}
          value={value}
          members={members}
          // Commit the select's new value explicitly — not via
          // setDraft + onCommit() — so the commit doesn't read a
          // stale draft closure. Commit-on-change is the correct UX
          // for a native <select> (it blurs as soon as its menu opens,
          // so blur-commit would fire before the user picks).
          onCommit={(next) => onCommit(next)}
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
  onCommit,
  onCancel,
  disabled,
}: {
  id: string;
  value: string;
  members: OrgMember[];
  onCommit: (v: string) => void;
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
      // Native <select> fires change on every pick; commit with the
      // new value directly rather than routing through draft state.
      onChange={(e) => onCommit(e.target.value)}
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
