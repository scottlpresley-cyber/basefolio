// Project detail page. Server component fetches everything the
// interactive tree needs on mount — the project, its updates, the
// last 5 audit entries, and the org member list (for the owner
// select) — then hands them to ProjectDetailInteractive which owns
// all the edit state from there.

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/context";
import {
  getProject,
  listProjectAuditLog,
  listProjectUpdates,
} from "@/lib/projects/queries";
import { listOrgMembers } from "@/lib/users/queries";
import { PageShell } from "@/components/layout/PageShell";
import { ProjectDetailInteractive } from "@/components/projects/ProjectDetailInteractive";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const auth = await getAuthContext(supabase);
  if (!auth) redirect("/login");

  const project = await getProject(supabase, id);
  if (!project) notFound();

  const [updates, auditEntries, members] = await Promise.all([
    listProjectUpdates(supabase, id),
    listProjectAuditLog(supabase, id),
    listOrgMembers(supabase),
  ]);

  return (
    <PageShell
      title={project.name}
      description={project.description ?? undefined}
    >
      <ProjectDetailInteractive
        initialProject={project}
        initialAuditEntries={auditEntries}
        initialUpdates={updates}
        members={members}
      />
    </PageShell>
  );
}
