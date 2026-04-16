import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app/sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const metadataName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar user={{ email: user.email ?? "", name: metadataName }} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
