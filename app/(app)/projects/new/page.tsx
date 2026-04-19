// New project page. Server component — resolves auth + fetches the
// org member list for the owner select in one server round-trip, then
// hands the data to the client form.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/context";
import { listOrgMembers } from "@/lib/users/queries";
import { PageShell } from "@/components/layout/PageShell";
import { ProjectForm } from "@/components/projects/ProjectForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add Project" };

export default async function NewProjectPage() {
  const supabase = await createClient();
  const auth = await getAuthContext(supabase);
  if (!auth) redirect("/login");

  const members = await listOrgMembers(supabase);

  return (
    <PageShell
      title="Add Project"
      description="A new tracked project in your portfolio. You can add milestones, risks, and status updates after it's saved."
    >
      <ProjectForm members={members} currentUserId={auth.userId} />
    </PageShell>
  );
}
