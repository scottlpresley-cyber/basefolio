"use client";

import { useCallback, useState } from "react";
import type { CanonicalField, ColumnMap, SourceTool } from "@/lib/file-processing/types";
import { ColumnMappingPanel } from "./ColumnMappingPanel";
import { ReadyToGenerate } from "./ReadyToGenerate";
import { ReportStream } from "./ReportStream";
import { UploadZone } from "./UploadZone";

export type UploadResponse = {
  storageKey: string;
  originalFilename: string;
  source: SourceTool;
  confidence: number;
  headers: string[];
  columnMap: ColumnMap;
  unmappedHeaders: string[];
  missingRequired: CanonicalField[];
  totalRowCount: number;
  preview: Array<Record<string, string | number | null>>;
  needsMapping: boolean;
};

export type UploadError = { message: string; code?: string };

type Phase = "upload" | "mapping" | "ready" | "generating";

export function StatusDraftFlow() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);

  const reset = useCallback(() => {
    setPhase("upload");
    setUploadResponse(null);
    setColumnMap({});
    setIsUploading(false);
    setUploadError(null);
  }, []);

  const handleFileSelected = useCallback(async (file: File) => {
    setUploadError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/status-draft/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        setUploadError({
          message: json?.error ?? "We couldn't process that file. Try again.",
          code: json?.code,
        });
        return;
      }
      const data = json as UploadResponse;
      setUploadResponse(data);
      setColumnMap({ ...data.columnMap });
      setPhase("mapping");
    } catch {
      setUploadError({
        message: "We couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleConfirm = useCallback((finalMap: ColumnMap) => {
    setColumnMap(finalMap);
    setPhase("ready");
  }, []);

  const handleGenerate = useCallback(() => {
    setPhase("generating");
  }, []);

  if (phase === "generating" && uploadResponse) {
    return (
      <ReportStream
        storageKey={uploadResponse.storageKey}
        columnMap={columnMap}
        originalFilename={uploadResponse.originalFilename}
        onStartOver={reset}
      />
    );
  }

  if (phase === "mapping" && uploadResponse) {
    return (
      <ColumnMappingPanel
        uploadResponse={uploadResponse}
        columnMap={columnMap}
        onColumnMapChange={setColumnMap}
        onConfirm={handleConfirm}
        onStartOver={reset}
      />
    );
  }

  if (phase === "ready" && uploadResponse) {
    return (
      <ReadyToGenerate
        uploadResponse={uploadResponse}
        columnMap={columnMap}
        onGenerate={handleGenerate}
        onStartOver={reset}
      />
    );
  }

  return (
    <UploadZone
      onFileSelected={handleFileSelected}
      isUploading={isUploading}
      error={uploadError}
      onClearError={() => setUploadError(null)}
      onPreflightError={(err) => setUploadError(err)}
    />
  );
}
