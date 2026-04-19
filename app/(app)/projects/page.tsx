// Projects list page. Server component — all data is fetched
// server-side and streamed in the initial HTML, per architecture §1.
//
// force-dynamic is belt-and-suspenders: using cookies() inside
// createClient() already makes this route dynamic, but making the
// intent explicit protects against a future refactor that accidentally
// serves an RLS-filtered snapshot to the wrong user. The Sprint 1
// sidebar-cache incident taught this lesson the hard way.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/context";
import { listProjects } from "@/lib/projects/queries";
import { PageShell } from "@/components/layout/PageShell";
import { AddProjectButton } from "@/components/projects/AddProjectButton";
import { ProjectsTable } from "@/components/projects/ProjectsTable";
import { ProjectsEmptyState } from "@/components/projects/ProjectsEmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const supabase = await createClient();
  const auth = await getAuthContext(supabase);
  if (!auth) redirect("/login");

  const projects = await listProjects(supabase);

  return (
    <PageShell title="Projects" actions={<AddProjectButton />}>
      {projects.length === 0 ? (
        <ProjectsEmptyState />
      ) : (
        <ProjectsTable projects={projects} />
      )}
    </PageShell>
  );
}
