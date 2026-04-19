// Primary "Add Project" CTA used in the page header and empty state.
// The /projects/new route is a Prompt 5 deliverable — during this
// sprint a click would 404 in production. Acceptable on preview; fix
// before launch.

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AddProjectButton() {
  return (
    <Button asChild variant="default" size="default">
      <Link href="/projects/new">Add Project</Link>
    </Button>
  );
}
