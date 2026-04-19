"use client";

// "Draft from notes" assist surface. Lives beneath the summary
// textarea in the Pattern 6 status update form. Drives the POST
// /api/projects/[id]/updates/assist route: collect messy notes,
// hand back a structured draft the parent form applies.
//
// States: 'idle' | 'expanded' | 'drafting' | 'applied'
//
// The parent (StatusUpdateForm) controls how the draft gets
// applied. This component just manages the notes surface, the
// Claude call, and its own post-success chrome.

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formInputClass } from "@/components/forms/FormField";

export type StatusAssistDraft = {
  summary: string;
  accomplishments: string | null;
  next_steps: string | null;
  blockers: string | null;
  suggested_health: "green" | "yellow" | "red";
};

type AssistState = "idle" | "expanded" | "drafting" | "applied";

export function StatusAssist({
  projectId,
  onApply,
  onUndo,
  showUndo,
  disabled,
}: {
  projectId: string;
  // Called with the parsed draft + the raw notes the user submitted.
  // Parent snapshots current form state before applying so Undo can
  // revert, and restores `notes` into our state if the user does so.
  onApply: (draft: StatusAssistDraft, notes: string) => void;
  // Called when the user clicks "Undo" post-apply. Parent restores
  // the pre-assist form snapshot; this component resets to the
  // 'expanded' state with the original notes pre-filled.
  onUndo: () => string;
  // Parent signal: is Undo still meaningful? Goes false once the
  // user has edited any AI-populated field.
  showUndo: boolean;
  disabled?: boolean;
}) {
  const [state, setState] = useState<AssistState>("idle");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleDraft() {
    if (notes.trim().length === 0) {
      setError("Paste some notes first.");
      return;
    }
    setError(null);
    setState("drafting");

    try {
      const response = await fetch(`/api/projects/${projectId}/updates/assist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      });

      if (response.status === 200) {
        const draft = (await response.json()) as StatusAssistDraft;
        onApply(draft, notes);
        setState("applied");
        return;
      }

      let body: {
        error?: string;
        code?: string;
        retry_after_seconds?: number;
      } = {};
      try {
        body = await response.json();
      } catch {
        /* non-JSON body */
      }

      if (response.status === 429 && typeof body.retry_after_seconds === "number") {
        setError(
          `${body.error ?? "Rate limit hit."} Try again in ${formatRetry(
            body.retry_after_seconds,
          )}.`,
        );
      } else if (response.status === 502) {
        setError(
          "The AI draft came back garbled. Try again — Claude occasionally blanks out on formatting.",
        );
      } else if (response.status === 401) {
        window.location.href = "/login";
        return;
      } else {
        setError(body.error ?? "We couldn't draft that. Try again.");
      }
      setState("expanded");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setState("expanded");
    }
  }

  function handleCancel() {
    setNotes("");
    setError(null);
    setState("idle");
  }

  function handleUndo() {
    const restoredNotes = onUndo();
    setNotes(restoredNotes);
    setError(null);
    setState("expanded");
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setState("expanded")}
        className={cn(
          "mt-1.5 flex items-center gap-1.5 text-xs font-medium text-teal hover:text-teal/80 transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden />
        Draft from notes
      </button>
    );
  }

  if (state === "applied") {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted">
        <Sparkles className="w-3.5 h-3.5 text-teal" aria-hidden />
        <span>Draft complete — review and edit.</span>
        {showUndo ? (
          <button
            type="button"
            onClick={handleUndo}
            className="text-teal hover:text-teal/80 font-medium"
          >
            Undo
          </button>
        ) : null}
      </div>
    );
  }

  // expanded or drafting
  const drafting = state === "drafting";
  return (
    <div
      className={cn(
        "mt-2 rounded border border-teal/30 bg-accent-bg p-3 space-y-2",
        "transition-all",
      )}
    >
      <label className="text-xs font-medium text-teal uppercase tracking-wide flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" aria-hidden />
        Draft from notes
      </label>
      <textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={drafting || disabled}
        maxLength={10000}
        placeholder="Paste your notes from the week. Meeting minutes, Slack threads, your own jottings — messier is fine."
        className={`${formInputClass} resize-y min-h-[96px]`}
      />
      {error ? (
        <p role="alert" className="text-xs text-health-red">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={drafting || disabled}
          onClick={handleDraft}
          className={cn(
            "inline-flex items-center gap-1.5 rounded bg-teal px-3 py-1.5 text-xs font-medium text-white",
            "disabled:opacity-60 disabled:cursor-not-allowed transition-opacity",
          )}
        >
          {drafting ? (
            <>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse"
                aria-hidden
              />
              Drafting...
            </>
          ) : (
            "Draft"
          )}
        </button>
        <button
          type="button"
          disabled={drafting}
          onClick={handleCancel}
          className="text-xs text-text-muted hover:text-text-secondary disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
