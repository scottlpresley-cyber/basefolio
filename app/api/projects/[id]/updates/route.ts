// POST /api/projects/[id]/updates — append a status update to a
// project's feed.
//
// Contract:
//   201 { ...row, author_name }            — success
//   400 { error, code, fields }            — zod validation failed
//   401 { error, code }                    — unauthenticated
//   404 { error, code }                    — project not in caller's org
//                                            (collapses "doesn't exist"
//                                             with "exists in another org"
//                                             — same secrecy story as
//                                             /projects/[id])
//   500 { error, code }                    — unexpected; details in logs only
//
// organization_id, project_id, and author_id are derived server-side
// from auth context and the URL param. Anything matching those keys
// in the request body is ignored. Same multi-tenancy hygiene as the
// /api/projects route.

import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/context";
import { getProject } from "@/lib/projects/queries";
import { createProjectUpdate } from "@/lib/projects/mutations";
import { newProjectUpdateInputSchema } from "@/lib/projects/update-schema";

export const runtime = "nodejs";

type FieldErrors = Record<string, string>;

function jsonError(
  status: number,
  body: { error: string; code: string } & Record<string, unknown>,
): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;

    const supabase = await createClient();
    const auth = await getAuthContext(supabase);
    if (!auth) {
      return jsonError(401, {
        error: "You need to be signed in to post a status update.",
        code: "UNAUTHENTICATED",
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonError(400, { error: "Invalid request body.", code: "BAD_REQUEST" });
    }

    const parsed = newProjectUpdateInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      const fields: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (path && !(path in fields)) fields[path] = issue.message;
      }
      return jsonError(400, {
        error: "Some fields need attention.",
        code: "VALIDATION_FAILED",
        fields,
      });
    }

    // Verify the project exists in the caller's org. RLS would also
    // block the insert via the project_id FK + org check, but a 404
    // here is a clearer error than a constraint violation, and it
    // mirrors the detail page's secrecy posture.
    const project = await getProject(supabase, projectId);
    if (!project) {
      return jsonError(404, {
        error: "Project not found.",
        code: "PROJECT_NOT_FOUND",
      });
    }

    const input = parsed.data;
    const created = await createProjectUpdate(supabase, {
      organization_id: auth.orgId,
      project_id: projectId,
      author_id: auth.userId,
      health: input.health,
      summary: input.summary,
      accomplishments: input.accomplishments ?? null,
      next_steps: input.next_steps ?? null,
      blockers: input.blockers ?? null,
      // period_start / period_end are not exposed in MVP UI; default
      // them to null so the row is well-formed without inferring a
      // week boundary the user didn't pick.
      period_start: null,
      period_end: null,
    });

    return Response.json(created, { status: 201 });
  } catch (err) {
    console.error("POST /api/projects/[id]/updates: unexpected error", err);
    return jsonError(500, {
      error: "Something went wrong on our end. Try again in a moment.",
      code: "INTERNAL_ERROR",
    });
  }
}
