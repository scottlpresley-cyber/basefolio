"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ColumnMap } from "@/lib/file-processing/types";

type Phase = "streaming" | "complete" | "error";

type Props = {
  storageKey: string;
  columnMap: ColumnMap;
  originalFilename: string;
  onStartOver: () => void;
};

const PROSE_CLASSES =
  "prose prose-sm max-w-none text-text-primary " +
  "prose-headings:text-text-primary prose-headings:font-semibold " +
  "prose-strong:text-text-primary prose-p:text-text-secondary";

export function ReportStream({
  storageKey,
  columnMap,
  originalFilename,
  onStartOver,
}: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("streaming");
  const [narrative, setNarrative] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    async function run() {
      setPhase("streaming");
      setNarrative("");
      setErrorMessage(null);

      try {
        const res = await fetch("/api/status-draft/generate", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageKey, columnMap, originalFilename }),
        });

        if (!res.ok || !res.body) {
          let message = "We couldn't generate your report. Try again.";
          try {
            const json = await res.json();
            if (json?.error) message = json.error;
          } catch {
            /* non-JSON error body */
          }
          if (!cancelled) {
            setErrorMessage(message);
            setPhase("error");
          }
          return;
        }

        const headerReportId = res.headers.get("X-Report-Id");
        if (headerReportId && !cancelled) setReportId(headerReportId);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk && !cancelled) {
            setNarrative((prev) => prev + chunk);
          }
        }
        const tail = decoder.decode();
        if (tail && !cancelled) setNarrative((prev) => prev + tail);

        if (!cancelled) setPhase("complete");
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("ReportStream fetch failed", err);
        if (!cancelled) {
          setErrorMessage(
            "We couldn't reach the server. Check your connection and try again.",
          );
          setPhase("error");
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [storageKey, columnMap, originalFilename, attempt]);

  const handleRetry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(narrative);
      toast("Report copied to clipboard.");
    } catch {
      toast("Copy failed. Select the text and copy manually.");
    }
  }, [narrative, toast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([narrative], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = toMarkdownFilename(originalFilename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [narrative, originalFilename]);

  const handleImport = useCallback(async () => {
    if (!reportId) {
      toast("Report isn't ready yet. Try again in a moment.");
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch("/api/status-draft/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId }),
      });
      const json = (await res.json()) as {
        imported?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok) {
        toast(json?.error ?? "We couldn't import these projects. Try again.");
        return;
      }
      const imported = json.imported ?? 0;
      const skipped = json.skipped ?? 0;
      if (imported === 0 && skipped > 0) {
        toast("Already imported. Redirecting...");
        setTimeout(() => router.push("/projects"), 1000);
        return;
      }
      toast(
        imported === 1 ? "1 project imported." : `${imported} projects imported.`,
      );
      router.push("/projects");
    } catch {
      toast("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsImporting(false);
    }
  }, [reportId, router, toast]);

  return (
    <div className="bg-surface border border-border rounded-md p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            Status report — {originalFilename}
          </h2>
          {reportId && (
            <p className="text-xs text-text-muted mt-1">Report ID: {reportId}</p>
          )}
        </div>
        {phase === "streaming" && (
          <span
            className="text-xs text-teal font-medium inline-flex items-center gap-1"
            aria-live="polite"
          >
            Drafting your report
            <span className="inline-block animate-pulse">▍</span>
          </span>
        )}
      </div>

      {phase === "error" ? (
        <div className="mt-4 rounded-md border border-health-red bg-health-red-bg text-health-red text-sm px-4 py-3">
          {errorMessage ?? "Something went wrong."}
        </div>
      ) : (
        <div className={`mt-4 border-l-2 border-teal pl-6 ${PROSE_CLASSES}`}>
          {narrative.length === 0 && phase === "streaming" ? (
            <p className="text-sm text-text-muted italic">
              Waiting for the first words...
            </p>
          ) : (
            <ReactMarkdown>{narrative}</ReactMarkdown>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3 flex-wrap">
        {phase === "complete" && (
          <>
            <Button variant="default" onClick={handleCopy}>
              Copy to clipboard
            </Button>
            <Button variant="outline" onClick={handleDownload}>
              Download as Markdown
            </Button>
            <Button
              variant="outline"
              onClick={handleImport}
              disabled={isImporting || !reportId}
            >
              Import to Basefolio
            </Button>
          </>
        )}
        {phase === "error" && (
          <Button variant="default" onClick={handleRetry}>
            Try again
          </Button>
        )}
        <Button variant="ghost" onClick={onStartOver}>
          Start over
        </Button>
      </div>
    </div>
  );
}

function toMarkdownFilename(original: string): string {
  const base = original.replace(/\.[^.]+$/, "") || "status-report";
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${safe}-status-report.md`;
}
