// Shared zod schema for the Add Status Update form and the matching
// POST /api/projects/[id]/updates route. Same single-source-of-truth
// pattern as lib/projects/schema.ts: empty strings normalize to
// undefined so the form's "" defaults validate cleanly without each
// caller knowing about the convention.

import { z } from 'zod'

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v)

export const projectHealthSchema = z.enum(['green', 'yellow', 'red'])

export const newProjectUpdateInputSchema = z.object({
  health: projectHealthSchema,

  summary: z
    .string()
    .trim()
    .min(1, 'Summary is required.')
    .max(4000, 'Summary must be 4000 characters or fewer.'),

  accomplishments: z.preprocess(
    emptyToUndef,
    z
      .string()
      .trim()
      .max(4000, 'Accomplishments must be 4000 characters or fewer.')
      .optional(),
  ),

  next_steps: z.preprocess(
    emptyToUndef,
    z
      .string()
      .trim()
      .max(4000, 'Next steps must be 4000 characters or fewer.')
      .optional(),
  ),

  blockers: z.preprocess(
    emptyToUndef,
    z
      .string()
      .trim()
      .max(4000, 'Blockers must be 4000 characters or fewer.')
      .optional(),
  ),
})

// Manually declared form-state type — every optional field is plain
// `string` so the HTML form's "" defaults type-check without each
// useForm consumer having to think about preprocess. Same trick as
// the new-project form.
export type NewProjectUpdateFormValues = {
  health: 'green' | 'yellow' | 'red'
  summary: string
  accomplishments: string
  next_steps: string
  blockers: string
}

export type NewProjectUpdateInput = z.output<typeof newProjectUpdateInputSchema>
