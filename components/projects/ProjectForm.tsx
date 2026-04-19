"use client";

// Add Project form. react-hook-form owns the state; zodResolver runs
// the shared lib/projects/schema so the client and the POST handler
// enforce identical rules.
//
// Error model:
//   - Field-level (422 from API or synchronous zod failure): rendered
//     per-field via form.formState.errors.
//   - Plan-limit (402): rendered as an inline upgrade banner above
//     the form — no redirect, form stays editable.
//   - Anything else: form-level error below the action row.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useForm,
  Controller,
  type Resolver,
  type SubmitHandler,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FormField, formInputClass } from "@/components/forms/FormField";
import { HealthToggle } from "@/components/forms/HealthToggle";
import { OptionalFieldsDisclosure } from "@/components/forms/OptionalFieldsDisclosure";
import {
  newProjectInputSchema,
  type NewProjectFormValues,
  type NewProjectInput,
} from "@/lib/projects/schema";
import type { OrgMember } from "@/lib/users/queries";
import { displayName } from "@/lib/users/display";

type FieldErrors = Partial<Record<keyof NewProjectFormValues, string>>;

type PlanLimitState = {
  limit: number;
  current: number;
  plan: string;
};

type ApiErrorBody = {
  error?: string;
  code?: string;
  fields?: FieldErrors;
  limit?: number;
  current?: number;
  plan?: string;
};

export function ProjectForm({
  members,
  currentUserId,
}: {
  members: OrgMember[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitState | null>(null);

  const form = useForm<NewProjectFormValues, unknown, NewProjectInput>({
    // zodResolver's transformed output flows into onSubmit — the
    // third useForm generic is what wires those two sides together.
    // The resolver cast narrows the schema's inferred `unknown` input
    // (caused by our z.preprocess normalizers) back to
    // NewProjectFormValues so useForm's form-state type stays clean.
    resolver: zodResolver(newProjectInputSchema) as unknown as Resolver<
      NewProjectFormValues,
      unknown,
      NewProjectInput
    >,
    defaultValues: {
      name: "",
      description: "",
      phase: "",
      health: "green",
      owner_id: currentUserId,
      start_date: "",
      target_end_date: "",
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    control,
  } = form;

  const onSubmit: SubmitHandler<NewProjectInput> = async (input) => {
    setFormError(null);
    setPlanLimit(null);

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (response.status === 201) {
      // Detail page (Prompt 6) doesn't exist yet; land on /projects
      // so the user can see the row they just created.
      router.push("/projects");
      router.refresh();
      return;
    }

    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON response — fall through to the generic error below.
    }

    if (response.status === 402 && typeof body.limit === "number" && typeof body.current === "number") {
      setPlanLimit({ limit: body.limit, current: body.current, plan: body.plan ?? "" });
      return;
    }

    if (response.status === 400 && body.fields) {
      for (const [field, message] of Object.entries(body.fields)) {
        if (typeof message === "string") {
          setError(field as keyof NewProjectFormValues, { type: "server", message });
        }
      }
      if (!Object.keys(body.fields).length && body.error) {
        setFormError(body.error);
      }
      return;
    }

    if (response.status === 401) {
      router.push("/login");
      return;
    }

    setFormError(body.error ?? "We couldn't save the project. Try again in a moment.");
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="bg-surface border border-border rounded-md overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">Project details</h2>
        <p className="text-xs text-text-muted mt-0.5">
          Required fields are marked. Optional fields fill in later if you don&apos;t have them now.
        </p>
      </div>

      {planLimit ? (
        <div
          role="status"
          className="mx-5 mt-4 flex items-start gap-3 rounded border border-health-yellow/30 bg-health-yellow-bg px-4 py-3"
        >
          <div className="text-xs">
            <p className="font-medium text-health-yellow">
              You&apos;ve hit your plan&apos;s project limit
            </p>
            <p className="text-text-secondary mt-0.5">
              {planLimit.current} of {planLimit.limit} projects used on the{" "}
              <span className="font-medium">{planLimit.plan || "current"}</span> plan. Upgrade
              from Settings &rarr; Billing to add more.
            </p>
          </div>
        </div>
      ) : null}

      <div className="px-5 py-4 space-y-5">
        <FormField
          label="Project name"
          htmlFor="project-name"
          required
          error={errors.name?.message}
        >
          <input
            id="project-name"
            type="text"
            autoComplete="off"
            maxLength={200}
            aria-invalid={!!errors.name}
            className={formInputClass}
            placeholder="e.g. Customer Portal rebuild"
            {...register("name")}
          />
        </FormField>

        <FormField label="Overall health" required error={errors.health?.message}>
          <Controller
            control={control}
            name="health"
            render={({ field }) => (
              <HealthToggle
                value={field.value ?? "green"}
                onChange={field.onChange}
                disabled={isSubmitting}
                name={field.name}
              />
            )}
          />
        </FormField>

        <OptionalFieldsDisclosure label="Add description, phase, owner, dates">
          <FormField
            label="Description"
            htmlFor="project-description"
            error={errors.description?.message}
          >
            <textarea
              id="project-description"
              rows={3}
              maxLength={2000}
              aria-invalid={!!errors.description}
              className={`${formInputClass} resize-none`}
              placeholder="What's the purpose of this project?"
              {...register("description")}
            />
          </FormField>

          <FormField label="Phase" htmlFor="project-phase" error={errors.phase?.message}>
            <input
              id="project-phase"
              type="text"
              autoComplete="off"
              maxLength={100}
              aria-invalid={!!errors.phase}
              className={formInputClass}
              placeholder="Planning, Execution, Closing..."
              {...register("phase")}
            />
          </FormField>

          <FormField label="Owner" htmlFor="project-owner" error={errors.owner_id?.message}>
            <select
              id="project-owner"
              aria-invalid={!!errors.owner_id}
              className={formInputClass}
              {...register("owner_id")}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {displayName(m)}
                  {m.id === currentUserId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </FormField>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              label="Start date"
              htmlFor="project-start-date"
              error={errors.start_date?.message}
            >
              <input
                id="project-start-date"
                type="date"
                aria-invalid={!!errors.start_date}
                className={formInputClass}
                {...register("start_date")}
              />
            </FormField>

            <FormField
              label="Target end date"
              htmlFor="project-target-end-date"
              error={errors.target_end_date?.message}
            >
              <input
                id="project-target-end-date"
                type="date"
                aria-invalid={!!errors.target_end_date}
                className={formInputClass}
                {...register("target_end_date")}
              />
            </FormField>
          </div>
        </OptionalFieldsDisclosure>

        {formError ? (
          <p role="alert" className="text-xs text-health-red">
            {formError}
          </p>
        ) : null}
      </div>

      <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-3">
        <Button asChild variant="ghost" size="default" disabled={isSubmitting}>
          <Link href="/projects">Cancel</Link>
        </Button>
        <Button type="submit" variant="default" size="default" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Add Project"}
        </Button>
      </div>
    </form>
  );
}
