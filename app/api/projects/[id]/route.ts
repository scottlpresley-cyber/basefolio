// PATCH /api/projects/[id] — inline-edit updates to a project.
//
// Contract:
//   200 { project, auditEntry: ProjectAuditEntry | null }
//                                          — success. auditEntry is
//                                            populated when health
//                                            changed, null otherwise.
//   400 { error, code, fields }            — zod validation failed
//   401 { error, code }                    — unauthenticated
//   404 { error, code }                    — project not in caller's
//                                            org (collapses
//                                            "doesn't exist" and
//                                            "exists in another org"
//                                            — same secrecy posture
//                                            as GET /projects/[id])
//   500 { error, code }                    — unexpected; details in
//                                            server logs only
//
// organization_id and id are stripped at the schema level (they're
// not in projectPatchSchema) and re-applied server-side from auth
// and the URL param. Health changes branch through
// updateProjectHealth which also writes to audit_log; non-health
// fields go through updateProject.

import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/context";
import { getProject } from "@/lib/projects/queries";
import {
  updateProject,
  updateProjectHealth,
} from "@/lib/projects/mutations";
import { projectPatchSchema } from "@/lib/projects/schema";
import type { Project, ProjectAuditEntry, ProjectPatch } from "@/types/app.types";

export const runtime = "nodejs";

type FieldErrors = Record<string, string>;

function jsonError(
  status: number,
  body: { error: string; code: string } & Record<string, unknown>,
): Response {
  return Response.json(body, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const auth = await getAuthContext(supabase);
    if (!auth) {
      return jsonError(401, {
        error: "You need to be signed in to edit this project.",
        code: "UNAUTHENTICATED",
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonError(400, { error: "Invalid request body.", code: "BAD_REQUEST" });
    }

    const parsed = projectPatchSchema.safeParse(rawBody);
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

    const existing = await getProject(supabase, id);
    if (!existing) {
      return jsonError(404, {
        error: "Project not found.",
        code: "PROJECT_NOT_FOUND",
      });
    }

    const patch = parsed.data;

    // Defense-in-depth cross-date check: single-field edits can
    // produce a start_date > existing target_end_date even though the
    // schema's refine only fires when both dates are in the patch.
    const effectiveStart =
      "start_date" in patch ? patch.start_date ?? null : existing.start_date;
    const effectiveTarget =
      "target_end_date" in patch
        ? patch.target_end_date ?? null
        : existing.target_end_date;
    if (
      effectiveStart &&
      effectiveTarget &&
      effectiveTarget < effectiveStart
    ) {
      return jsonError(400, {
        error: "Some fields need attention.",
        code: "VALIDATION_FAILED",
        fields: {
          target_end_date:
            "Target end date must be on or after the start date.",
        },
      });
    }

    let project: Project = existing;
    let auditEntry: ProjectAuditEntry | null = null;

    // Health change branches through updateProjectHealth so the
    // audit_log insert happens. A no-op health change (same value
    // in patch as current) still falls through to updateProject for
    // consistency, but doesn't write an audit row.
    if (patch.health !== undefined && patch.health !== existing.health) {
      const r = await updateProjectHealth(supabase, id, patch.health, auth.userId);
      project = r.project;
      auditEntry = r.auditEntry;
    }

    // Every non-health field the caller actually sent. Omitted keys
    // stay omitted so we don't clobber fields the user didn't touch.
    const nonHealthPatch: ProjectPatch = {};
    if ("phase" in patch) nonHealthPatch.phase = patch.phase ?? null;
    if ("owner_id" in patch) nonHealthPatch.owner_id = patch.owner_id ?? null;
    if ("start_date" in patch)
      nonHealthPatch.start_date = patch.start_date ?? null;
    if ("target_end_date" in patch)
      nonHealthPatch.target_end_date = patch.target_end_date ?? null;

    if (Object.keys(nonHealthPatch).length > 0) {
      project = await updateProject(supabase, id, nonHealthPatch);
    }

    return Response.json({ project, auditEntry }, { status: 200 });
  } catch (err) {
    console.error("PATCH /api/projects/[id]: unexpected error", err);
    return jsonError(500, {
      error: "Something went wrong on our end. Try again in a moment.",
      code: "INTERNAL_ERROR",
    });
  }
}
