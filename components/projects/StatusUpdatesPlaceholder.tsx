// Scaffold for the status-update region on the project detail page.
// Prompt 6B replaces this wholesale with the real form + feed. Kept
// intentionally low-polish — a landing strip of card-shaped empty
// state so the layout looks complete in screenshots without investing
// in throwaway UI.

export function StatusUpdatesPlaceholder() {
  return (
    <section
      aria-label="Status updates"
      className="bg-surface border border-border rounded-md"
    >
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">Status updates</h2>
      </div>
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-text-muted max-w-sm mx-auto">
          Status updates will appear here. The form to add the first one is coming
          in the next update.
        </p>
      </div>
    </section>
  );
}
