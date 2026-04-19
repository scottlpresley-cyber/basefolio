// Project detail page shell. Renders the project name (via
// PageShell), a metadata header, the metadata sidebar, and a
// placeholder region where Prompt 6B will wire in the real status
// update form and feed.
//
// notFound() is correct for both "doesn't exist" and "exists but
// belongs to another org" — getProject returns null in both cases
// because RLS hides cross-tenant rows. A 403 would leak the existence
// of the row; a 404 doesn't.

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/context";
import { getProject, listProjectUpdates } from "@/lib/projects/queries";
import { PageShell } from "@/components/layout/PageShell";
import {
  ProjectDetailLayout,
  ProjectDetailMain,
  ProjectDetailSidebarCol,
} from "@/components/projects/ProjectDetailLayout";
import { ProjectDetailHeader } from "@/components/projects/ProjectDetailHeader";
import { ProjectDetailSidebar } from "@/components/projects/ProjectDetailSidebar";
import { ProjectUpdatesSection } from "@/components/projects/ProjectUpdatesSection";

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

  // Fetch updates after the project read so an RLS-hidden project
  // short-circuits to 404 without an extra round-trip.
  const updates = await listProjectUpdates(supabase, id);

  return (
    <PageShell
      title={project.name}
      description={project.description ?? undefined}
    >
      <ProjectDetailLayout>
        <ProjectDetailMain>
          <ProjectDetailHeader project={project} />
          <ProjectUpdatesSection projectId={id} initialUpdates={updates} />
        </ProjectDetailMain>
        <ProjectDetailSidebarCol>
          <ProjectDetailSidebar project={project} />
        </ProjectDetailSidebarCol>
      </ProjectDetailLayout>
    </PageShell>
  );
}
