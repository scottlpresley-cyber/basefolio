// Shared zod schema for the Add Project form and POST /api/projects.
// The same schema runs client-side (react-hook-form resolver) and
// server-side (route handler validation) — single source of truth for
// the input contract.
//
// Empty strings are normalized to undefined so the form state can use
// "" for unset optional fields without each call site knowing that
// convention.

import { z } from 'zod'

const emptyToUndef = (value: unknown) =>
  value === '' || value === null ? undefined : value

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const projectHealthSchema = z.enum(['green', 'yellow', 'red'])

export const newProjectInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required.')
      .max(200, 'Name must be 200 characters or fewer.'),

    description: z.preprocess(
      emptyToUndef,
      z.string().trim().max(2000, 'Description must be 2000 characters or fewer.').optional(),
    ),

    phase: z.preprocess(
      emptyToUndef,
      z.string().trim().max(100, 'Phase must be 100 characters or fewer.').optional(),
    ),

    health: projectHealthSchema,

    owner_id: z.preprocess(
      emptyToUndef,
      z.string().uuid('Invalid owner selection.').optional(),
    ),

    start_date: z.preprocess(
      emptyToUndef,
      z.string().regex(ISO_DATE_RE, 'Start date must be YYYY-MM-DD.').optional(),
    ),

    target_end_date: z.preprocess(
      emptyToUndef,
      z.string().regex(ISO_DATE_RE, 'Target end date must be YYYY-MM-DD.').optional(),
    ),
  })
  .refine(
    (d) =>
      !d.start_date ||
      !d.target_end_date ||
      // ISO 'YYYY-MM-DD' strings sort lexicographically — no Date parsing needed.
      d.target_end_date >= d.start_date,
    {
      message: 'Target end date must be on or after the start date.',
      path: ['target_end_date'],
    },
  )

// Form state shape: plain strings for every field, which is what an
// HTML form actually emits. The schema's preprocess layer normalizes
// "" -> undefined on validation, so the form can default every
// optional field to "" without each input knowing that convention.
// Declared explicitly (rather than via z.input) because preprocess
// widens the inferred input type to `unknown`, which would defeat
// react-hook-form's type narrowing.
export type NewProjectFormValues = {
  name: string
  description: string
  phase: string
  health: 'green' | 'yellow' | 'red'
  owner_id: string
  start_date: string
  target_end_date: string
}

// Post-validation payload: what the route handler processes and what
// the onSubmit callback receives. Matches z.output<schema>.
export type NewProjectInput = z.output<typeof newProjectInputSchema>

// Inline-edit patch schema for PATCH /api/projects/[id].
//
// Semantics on the wire:
//   - omitted key         -> "don't touch this field"
//   - null                -> "unset to null" (distinct from omit —
//                            needed so "Unassigned" owner works)
//   - "" (empty string)   -> normalized to null via preprocess
//   - non-empty string    -> validated as that field's shape
//
// The refine only fires when BOTH dates are in the patch body. Single-
// date edits where the cross-field check matters (changing start_date
// past an existing target_end_date) are caught by the PATCH handler
// merging the patch with the current project — defense in depth.
const emptyToNull = (v: unknown) => (v === '' ? null : v)

export const projectPatchSchema = z
  .object({
    health: projectHealthSchema.optional(),

    phase: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .max(100, 'Phase must be 100 characters or fewer.')
        .nullable()
        .optional(),
    ),

    owner_id: z.preprocess(
      emptyToNull,
      z.string().uuid('Invalid owner selection.').nullable().optional(),
    ),

    start_date: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD.')
        .nullable()
        .optional(),
    ),

    target_end_date: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Target end date must be YYYY-MM-DD.')
        .nullable()
        .optional(),
    ),
  })
  .refine(
    (d) =>
      !d.start_date ||
      !d.target_end_date ||
      d.target_end_date >= d.start_date,
    {
      message: 'Target end date must be on or after the start date.',
      path: ['target_end_date'],
    },
  )

export type ProjectPatchInput = z.output<typeof projectPatchSchema>
