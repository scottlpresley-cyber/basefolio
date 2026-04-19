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
import { getProject } from "@/lib/projects/queries";
import { PageShell } from "@/components/layout/PageShell";
import {
  ProjectDetailLayout,
  ProjectDetailMain,
  ProjectDetailSidebarCol,
} from "@/components/projects/ProjectDetailLayout";
import { ProjectDetailHeader } from "@/components/projects/ProjectDetailHeader";
import { ProjectDetailSidebar } from "@/components/projects/ProjectDetailSidebar";
import { StatusUpdatesPlaceholder } from "@/components/projects/StatusUpdatesPlaceholder";

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

  return (
    <PageShell
      title={project.name}
      description={project.description ?? undefined}
    >
      <ProjectDetailLayout>
        <ProjectDetailMain>
          <ProjectDetailHeader project={project} />
          <StatusUpdatesPlaceholder />
        </ProjectDetailMain>
        <ProjectDetailSidebarCol>
          <ProjectDetailSidebar project={project} />
        </ProjectDetailSidebarCol>
      </ProjectDetailLayout>
    </PageShell>
  );
}
