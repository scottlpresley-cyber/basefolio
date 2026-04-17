import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirectTo = url.searchParams.get("redirectTo");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth", url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth", url));
  }

  // Only accept same-origin relative paths. `//foo` is protocol-relative and
  // would resolve to a different host — reject it to prevent open redirects.
  const safePath =
    redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/dashboard";

  return NextResponse.redirect(new URL(safePath, url));
}
