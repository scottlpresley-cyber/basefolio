"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "submitting" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=/dashboard`,
        },
      });
      setStatus(error ? "error" : "sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight text-white">
          Basefolio
        </h1>

        <div className="rounded-md border border-border bg-surface p-8 shadow-md">
          {status === "sent" ? (
            <p
              className="text-center text-sm text-text-primary"
              aria-live="polite"
            >
              Check your email — your login link is on the way.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-text-primary"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={status === "submitting"}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-disabled focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30 disabled:opacity-60"
                />
              </div>

              <button
                type="submit"
                disabled={status === "submitting" || email.length === 0}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {status === "submitting" ? "Sending..." : "Send login link"}
              </button>

              {status === "error" && (
                <p role="alert" className="text-sm text-destructive">
                  Something went wrong. Try again.
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
