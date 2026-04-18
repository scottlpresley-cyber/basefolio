import { StatusDraftFlow } from "@/components/status-draft/StatusDraftFlow";

export const metadata = { title: "Status Draft" };

export default function StatusDraftPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Status Draft</h1>
        <p className="text-sm text-text-muted mt-1 max-w-2xl">
          Upload a CSV or XLSX export from Azure DevOps, Jira, or Smartsheet.
          We&apos;ll detect your columns and draft a portfolio report.
        </p>
      </header>
      <StatusDraftFlow />
    </div>
  );
}
