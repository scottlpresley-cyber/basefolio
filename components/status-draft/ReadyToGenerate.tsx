"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { CanonicalField, ColumnMap, SourceTool } from "@/lib/file-processing/types";
import type { UploadResponse } from "./StatusDraftFlow";

type Props = {
  uploadResponse: UploadResponse;
  columnMap: ColumnMap;
  onGenerate: () => void;
  onStartOver: () => void;
};

const SOURCE_LABEL: Record<SourceTool, string> = {
  ado: "Azure DevOps",
  jira: "Jira",
  smartsheet: "Smartsheet",
  unknown: "Unknown source",
};

const GROUPING_PRIORITY: CanonicalField[] = [
  "area_path",
  "epic",
  "iteration",
  "tags",
];

function firstTagOrValue(raw: unknown, isTag: boolean): string {
  if (raw === null || raw === undefined) return "";
  const str = typeof raw === "number" ? String(raw) : String(raw);
  const trimmed = str.trim();
  if (!trimmed) return "";
  if (!isTag) return trimmed;
  return trimmed.split(/[,;]/)[0]?.trim() ?? "";
}

function countDistinctGroups(
  rows: UploadResponse["preview"],
  columnMap: ColumnMap,
): { count: number; ungrouped: boolean } {
  if (rows.length === 0) return { count: 1, ungrouped: true };
  for (const key of GROUPING_PRIORITY) {
    const header = columnMap[key];
    if (!header) continue;
    const isTag = key === "tags";
    const anyValue = rows.some(
      (row) => firstTagOrValue(row[header], isTag).length > 0,
    );
    if (!anyValue) continue;
    const seen = new Set<string>();
    for (const row of rows) {
      const value = firstTagOrValue(row[header], isTag);
      seen.add(value.length > 0 ? value : "Ungrouped");
    }
    return { count: seen.size, ungrouped: false };
  }
  return { count: 1, ungrouped: true };
}

export function ReadyToGenerate({
  uploadResponse,
  columnMap,
  onGenerate,
  onStartOver,
}: Props) {
  const { originalFilename, source, preview } = uploadResponse;
  const sourceLabel = SOURCE_LABEL[source];

  const { count, ungrouped } = useMemo(
    () => countDistinctGroups(preview, columnMap),
    [preview, columnMap],
  );

  const recap = ungrouped
    ? "Your rows will be grouped into a single Ungrouped project."
    : `${count} ${count === 1 ? "project" : "projects"} detected across ${sourceLabel}`;

  return (
    <div className="bg-surface border border-border rounded-md p-6">
      <h2 className="text-lg font-semibold text-text-primary">
        Ready to generate a report from {originalFilename}
      </h2>
      <p className="text-sm text-text-muted mt-1">{recap}</p>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="default" onClick={onGenerate}>
          Generate report
        </Button>
        <Button variant="outline" onClick={onStartOver}>
          Start over
        </Button>
      </div>
    </div>
  );
}
