"use client";

// Generic state machine for an inline-editable field. Handles:
//   - display <-> editor swap on click / Enter / Space
//   - Escape cancels and reverts
//   - Enter or blur commits (the editor decides which — it calls
//     onCommit at the right moment)
//   - saving state (editor disabled while the network call runs)
//   - error state (revert + surface message to parent via onError)
//
// The field-specific variants (Phase, Owner, Date) wrap this and
// supply the renderEditor. HealthEditor is a separate component
// because the "pill is the editor trigger AND the display" pattern
// doesn't fit the display/editor swap shape here.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EditableFieldRenderEditorProps<T> = {
  value: T;
  onChange: (next: T) => void;
  onCommit: () => void;
  onCancel: () => void;
  id: string;
  disabled: boolean;
};

export function EditableField<T>({
  value,
  onSave,
  renderDisplay,
  renderEditor,
  ariaLabel,
  className,
  displayClassName,
}: {
  value: T;
  onSave: (next: T) => Promise<void>;
  renderDisplay: (value: T) => ReactNode;
  renderEditor: (props: EditableFieldRenderEditorProps<T>) => ReactNode;
  ariaLabel: string;
  className?: string;
  displayClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);
  const [saving, setSaving] = useState(false);
  const editorId = useId();
  const committedRef = useRef(false);

  // If the parent passes a new value (e.g. a server reconciliation
  // from the PATCH response) while we're not editing, accept it.
  // While editing, keep the draft — committing is the user's choice.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function startEdit() {
    if (saving) return;
    committedRef.current = false;
    setDraft(value);
    setEditing(true);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  async function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    // No-op when the value hasn't changed — avoid a network round-trip
    // when the user clicks out after opening the editor.
    if (Object.is(draft, value)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // onSave is expected to surface the error via a toast or
      // parent-rendered inline message. We revert the draft to the
      // previous committed value either way.
      setDraft(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className={className}>
        {renderEditor({
          value: draft,
          onChange: setDraft,
          onCommit: commit,
          onCancel: cancel,
          id: editorId,
          disabled: saving,
        })}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={`Edit ${ariaLabel}`}
      className={cn(
        "inline-flex items-center text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 hover:bg-surface-hover px-1 -mx-1 transition-colors",
        displayClassName,
      )}
    >
      {renderDisplay(value)}
    </button>
  );
}
