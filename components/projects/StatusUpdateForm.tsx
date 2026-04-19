"use client";

// The most-used form in the product. Per ui-context.md Pattern 6:
// inline health toggle, summary as the primary field, optional
// fields collapsed by default, save button on the right, no spinners.
//
// Reset model: the parent ProjectUpdatesSection bumps a `key` on
// success so this whole component remounts. That naturally resets
// useForm state, recollapses the disclosure, and re-fires the
// summary autofocus — no controlled-state plumbing required.
//
// "Draft from notes" AI assist is soft-scope and intentionally not
// rendered here. Pattern 6 leaves space for it under the summary
// field; we leave the same gap so adding it later is a single
// component drop-in.

import { useEffect, useRef, useState } from "react";
import {
  useForm,
  Controller,
  type Resolver,
  type SubmitHandler,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { FormField, formInputClass } from "@/components/forms/FormField";
import { HealthToggle } from "@/components/forms/HealthToggle";
import { OptionalFieldsDisclosure } from "@/components/forms/OptionalFieldsDisclosure";
import {
  newProjectUpdateInputSchema,
  type NewProjectUpdateFormValues,
  type NewProjectUpdateInput,
} from "@/lib/projects/update-schema";
import type { ProjectHealth, ProjectUpdate } from "@/types/app.types";

type ApiErrorBody = {
  error?: string;
  code?: string;
  fields?: Partial<Record<keyof NewProjectUpdateFormValues, string>>;
};

// "Week of MMM D, YYYY" anchored on the Monday of the current week.
// Computed once per mount (the form key-bumps on every save so any
// stale label gets refreshed alongside everything else).
function currentWeekLabel(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + offset);
  return `Week of ${monday.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function StatusUpdateForm({
  projectId,
  defaultHealth,
  onSaved,
}: {
  projectId: string;
  defaultHealth: ProjectHealth;
  onSaved: (created: ProjectUpdate) => void;
}) {
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<NewProjectUpdateFormValues, unknown, NewProjectUpdateInput>({
    // Same input/output split + cast as ProjectForm — see
    // lib/projects/update-schema.ts for the full reasoning. Keeps the
    // useForm field-state type clean while letting the resolver
    // narrow to the post-validation shape on submit.
    resolver: zodResolver(newProjectUpdateInputSchema) as unknown as Resolver<
      NewProjectUpdateFormValues,
      unknown,
      NewProjectUpdateInput
    >,
    defaultValues: {
      health: defaultHealth,
      summary: "",
      accomplishments: "",
      next_steps: "",
      blockers: "",
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    control,
  } = form;

  // Autofocus the summary textarea on mount so the first keystroke
  // is already in the right place. Wired through a ref rather than
  // `autoFocus` because ref + useEffect plays better with the
  // remount-on-save pattern.
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  const onSubmit: SubmitHandler<NewProjectUpdateInput> = async (input) => {
    setFormError(null);

    const response = await fetch(`/api/projects/${projectId}/updates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (response.status === 201) {
      const created = (await response.json()) as ProjectUpdate;
      toast("Status update saved.");
      onSaved(created);
      return;
    }

    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON response — fall through to the generic error below.
    }

    if (response.status === 400 && body.fields) {
      for (const [field, message] of Object.entries(body.fields)) {
        if (typeof message === "string") {
          setError(field as keyof NewProjectUpdateFormValues, {
            type: "server",
            message,
          });
        }
      }
      if (!Object.keys(body.fields).length && body.error) {
        setFormError(body.error);
      }
      return;
    }

    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }

    if (response.status === 404) {
      setFormError(body.error ?? "Project not found. Refresh the page and try again.");
      return;
    }

    setFormError(body.error ?? "We couldn't save the update. Try again in a moment.");
  };

  // The Controller is named so we can wire the textarea ref alongside
  // react-hook-form's register without losing the field object.
  const summaryRegistration = register("summary");

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="bg-surface border border-border rounded-md overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary">Add Status Update</h3>
        <p className="text-xs text-text-muted mt-0.5">{currentWeekLabel()}</p>
      </div>

      <div className="px-5 py-4 space-y-4">
        <FormField label="Overall health" required error={errors.health?.message}>
          <Controller
            control={control}
            name="health"
            render={({ field }) => (
              <HealthToggle
                value={field.value ?? defaultHealth}
                onChange={field.onChange}
                disabled={isSubmitting}
                name={field.name}
              />
            )}
          />
        </FormField>

        <FormField
          label="Summary"
          htmlFor="status-update-summary"
          required
          error={errors.summary?.message}
        >
          <textarea
            id="status-update-summary"
            rows={3}
            maxLength={4000}
            aria-invalid={!!errors.summary}
            placeholder="What's the status this week? Key progress, blockers, decisions needed."
            className={`${formInputClass} resize-y min-h-[88px]`}
            {...summaryRegistration}
            ref={(el) => {
              summaryRegistration.ref(el);
              summaryRef.current = el;
            }}
          />
          {/* Pattern 6 reserves space here for the AI "Draft from notes"
              button. Soft scope — not rendered now, but the layout
              accommodates it so adding the button later is one drop-in. */}
        </FormField>

        <OptionalFieldsDisclosure label="Add accomplishments, next steps, blockers">
          <FormField
            label="Accomplishments"
            htmlFor="status-update-accomplishments"
            error={errors.accomplishments?.message}
          >
            <textarea
              id="status-update-accomplishments"
              rows={3}
              maxLength={4000}
              aria-invalid={!!errors.accomplishments}
              className={`${formInputClass} resize-y`}
              placeholder="Wins this week."
              {...register("accomplishments")}
            />
          </FormField>

          <FormField
            label="Next steps"
            htmlFor="status-update-next-steps"
            error={errors.next_steps?.message}
          >
            <textarea
              id="status-update-next-steps"
              rows={3}
              maxLength={4000}
              aria-invalid={!!errors.next_steps}
              className={`${formInputClass} resize-y`}
              placeholder="What's next."
              {...register("next_steps")}
            />
          </FormField>

          <FormField
            label="Blockers"
            htmlFor="status-update-blockers"
            error={errors.blockers?.message}
          >
            <textarea
              id="status-update-blockers"
              rows={3}
              maxLength={4000}
              aria-invalid={!!errors.blockers}
              className={`${formInputClass} resize-y`}
              placeholder="What's in the way."
              {...register("blockers")}
            />
          </FormField>
        </OptionalFieldsDisclosure>

        {formError ? (
          <p role="alert" className="text-xs text-health-red">
            {formError}
          </p>
        ) : null}
      </div>

      <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          size="default"
          disabled={isSubmitting}
          onClick={() => form.reset()}
        >
          Cancel
        </Button>
        <Button type="submit" variant="default" size="default" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Update"}
        </Button>
      </div>
    </form>
  );
}
