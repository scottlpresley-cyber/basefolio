// Single status update rendered as a card. Plain text only —
// whitespace-pre-wrap preserves line breaks but markdown is not
// interpreted (a literal **bold** stays as asterisks). Rich text is
// a v2 question.
//
// "Posted by" line is omitted entirely when author_name is null
// rather than rendering "Unknown" — cold copy that doesn't help the
// reader. displayName has already done its full_name -> email-local
// fallback at query time, so a real null here means the author row
// was deleted or RLS hid it (cross-org), both of which are unusual.

import { HealthBadge } from "@/components/projects/HealthBadge";
import { formatDate } from "@/lib/utils/date";
import type { ProjectHealth, ProjectUpdate } from "@/types/app.types";

function isHealth(value: string): value is ProjectHealth {
  return value === "green" || value === "yellow" || value === "red";
}

function Section({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
        {text}
      </p>
    </div>
  );
}

export function UpdateCard({ update }: { update: ProjectUpdate }) {
  const health: ProjectHealth = isHealth(update.health) ? update.health : "green";
  const hasOptional =
    !!update.accomplishments?.trim() ||
    !!update.next_steps?.trim() ||
    !!update.blockers?.trim();

  return (
    <article className="bg-surface border border-border rounded-md p-5">
      <header className="flex items-center justify-between mb-3 gap-3">
        <HealthBadge status={health} />
        <time
          dateTime={update.created_at}
          className="text-xs text-text-muted shrink-0"
        >
          {formatDate(update.created_at, "short")}
        </time>
      </header>

      <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
        {update.summary}
      </p>

      {hasOptional ? (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          {update.accomplishments?.trim() ? (
            <Section label="Accomplishments" text={update.accomplishments} />
          ) : null}
          {update.next_steps?.trim() ? (
            <Section label="Next steps" text={update.next_steps} />
          ) : null}
          {update.blockers?.trim() ? (
            <Section label="Blockers" text={update.blockers} />
          ) : null}
        </div>
      ) : null}

      {update.author_name ? (
        <footer className="mt-4 text-xs text-text-muted">
          Posted by {update.author_name}
        </footer>
      ) : null}
    </article>
  );
}
