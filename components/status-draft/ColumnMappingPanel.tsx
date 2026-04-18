"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { CanonicalField, ColumnMap, SourceTool } from "@/lib/file-processing/types";
import type { UploadResponse } from "./StatusDraftFlow";

type Props = {
  uploadResponse: UploadResponse;
  columnMap: ColumnMap;
  onColumnMapChange: (next: ColumnMap) => void;
  onConfirm: (finalMap: ColumnMap) => void;
  onStartOver: () => void;
};

type FieldDef = {
  key: CanonicalField;
  label: string;
  required?: boolean;
};

const FIELDS: FieldDef[] = [
  { key: "title", label: "Title", required: true },
  { key: "status", label: "Status", required: true },
  { key: "assignee", label: "Assignee" },
  { key: "area_path", label: "Area path" },
  { key: "iteration", label: "Iteration / Sprint" },
  { key: "epic", label: "Epic" },
  { key: "tags", label: "Tags" },
  { key: "due_date", label: "Due date" },
  { key: "work_item_type", label: "Work item type" },
  { key: "story_points", label: "Story points" },
  { key: "completed_date", label: "Completed date" },
];

const SOURCE_LABEL: Record<SourceTool, string> = {
  ado: "Azure DevOps",
  jira: "Jira",
  smartsheet: "Smartsheet",
  unknown: "Unknown source",
};

const REQUIRED_KEYS: CanonicalField[] = ["title", "status"];

export function ColumnMappingPanel({
  uploadResponse,
  columnMap,
  onColumnMapChange,
  onConfirm,
  onStartOver,
}: Props) {
  const { source, confidence, headers, originalFilename, totalRowCount, preview } =
    uploadResponse;

  const missingRequired = useMemo(
    () => REQUIRED_KEYS.filter((k) => !columnMap[k]),
    [columnMap],
  );

  const canContinue = missingRequired.length === 0;

  const handleSelectChange = (field: CanonicalField, value: string) => {
    const next: ColumnMap = { ...columnMap };
    if (value === "") {
      delete next[field];
    } else {
      for (const f of Object.keys(next) as CanonicalField[]) {
        if (next[f] === value && f !== field) {
          delete next[f];
        }
      }
      next[field] = value;
    }
    onColumnMapChange(next);
  };

  const confidenceLine = (() => {
    if (source === "unknown") {
      return "We couldn't auto-detect your tool. Map your columns below.";
    }
    if (confidence >= 0.85) {
      return `We're ${Math.round(confidence * 100)}% confident about the detected columns.`;
    }
    return "We're less sure about some of these — review below.";
  })();

  const previewHeaders = headers.filter((h) => h.length > 0);
  const previewRows = preview.slice(0, 5);
  const gridTemplate = `repeat(${previewHeaders.length}, minmax(140px, 1fr))`;

  return (
    <div className="bg-surface border border-border rounded-md">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center bg-gray-light border border-border text-text-secondary rounded px-2 py-0.5 text-xs font-medium">
          {SOURCE_LABEL[source]}
        </span>
        <span className="text-sm font-medium text-text-primary truncate">
          {originalFilename}
        </span>
        <span className="text-sm text-text-muted">
          · {totalRowCount} {totalRowCount === 1 ? "row" : "rows"}
        </span>
      </div>

      <div className="px-5 pt-4">
        <p className="text-xs text-text-muted">{confidenceLine}</p>
      </div>

      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-text-primary mb-3">
          Column mapping
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((field) => {
            const value = columnMap[field.key] ?? "";
            const isMissing =
              field.required && missingRequired.includes(field.key);
            return (
              <div key={field.key}>
                <label className="text-sm font-medium text-text-secondary block mb-1.5">
                  {field.label}
                  {field.required && (
                    <span className="text-text-muted font-normal">
                      {" "}
                      (required)
                    </span>
                  )}
                </label>
                <select
                  value={value}
                  onChange={(e) => handleSelectChange(field.key, e.target.value)}
                  className="w-full px-3 py-2 text-sm text-text-primary bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
                >
                  <option value="">— none —</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                {isMissing && (
                  <p className="text-xs text-health-red mt-1">
                    Required — pick a column.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-5 pb-4">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
          File preview · first {previewRows.length} of {totalRowCount} rows
        </h3>
        <div className="border border-border rounded overflow-x-auto">
          <div
            className="grid bg-gray-light border-b border-border"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {previewHeaders.map((h) => (
              <div
                key={h}
                className="px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wide truncate"
                title={h}
              >
                {h}
              </div>
            ))}
          </div>
          <div className="max-h-[220px] overflow-y-auto">
            {previewRows.map((row, idx) => (
              <div
                key={idx}
                className="grid border-b border-border last:border-0"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {previewHeaders.map((h) => {
                  const raw = row[h];
                  const cell =
                    raw === null || raw === undefined ? "" : String(raw);
                  return (
                    <div
                      key={h}
                      className="px-3 py-2 font-mono text-xs text-text-secondary truncate"
                      title={cell}
                    >
                      {cell}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-border flex items-center justify-between">
        <Button variant="ghost" onClick={onStartOver}>
          Start over
        </Button>
        <Button
          variant="default"
          disabled={!canContinue}
          onClick={() => onConfirm(columnMap)}
          title={canContinue ? undefined : "Map title and status to continue."}
        >
          Looks good — continue
        </Button>
      </div>
    </div>
  );
}
