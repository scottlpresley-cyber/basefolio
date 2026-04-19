// POST /api/projects — create a project in the caller's org.
//
// Contract:
//   201 { id }                              — success
//   400 { error, code, fields }             — zod validation failed
//   401 { error, code }                     — unauthenticated
//   402 { error, code, limit, current, plan } — plan limit hit
//   500 { error, code }                     — unexpected; details in server logs only
//
// organization_id is pulled from the authenticated session — never
// from the request body, even if the client sends one. Same for id.

import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/context";
import { createProject } from "@/lib/projects/mutations";
import { enforceProjectLimit, PlanLimitError } from "@/lib/projects/plan-limits";
import { newProjectInputSchema } from "@/lib/projects/schema";

export const runtime = "nodejs";

type FieldErrors = Record<string, string>;

function jsonError(
  status: number,
  body: { error: string; code: string } & Record<string, unknown>,
): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const auth = await getAuthContext(supabase);
    if (!auth) {
      return jsonError(401, {
        error: "You need to be signed in to add a project.",
        code: "UNAUTHENTICATED",
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonError(400, { error: "Invalid request body.", code: "BAD_REQUEST" });
    }

    const parsed = newProjectInputSchema.safeParse(rawBody);
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

    try {
      await enforceProjectLimit(supabase, auth.orgPlan);
    } catch (err) {
      if (err instanceof PlanLimitError) {
        return jsonError(402, {
          error: err.message,
          code: "PLAN_LIMIT_REACHED",
          limit: err.limit,
          current: err.current,
          plan: err.plan,
        });
      }
      throw err;
    }

    // Explicitly construct the insert payload rather than spreading
    // rawBody — belt-and-suspenders against a rogue organization_id,
    // id, or status field sneaking through.
    const input = parsed.data;
    const created = await createProject(supabase, {
      organization_id: auth.orgId,
      name: input.name,
      description: input.description ?? null,
      phase: input.phase ?? null,
      health: input.health,
      owner_id: input.owner_id ?? null,
      start_date: input.start_date ?? null,
      target_end_date: input.target_end_date ?? null,
    });

    return Response.json({ id: created.id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/projects: unexpected error", err);
    return jsonError(500, {
      error: "Something went wrong on our end. Try again in a moment.",
      code: "INTERNAL_ERROR",
    });
  }
}
