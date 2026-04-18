"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadError } from "./StatusDraftFlow";

const ALLOWED_EXT = [".csv", ".xls", ".xlsx"];
const MAX_BYTES = 10 * 1024 * 1024;
const PROGRESS_MESSAGES = [
  "Parsing your file...",
  "Identifying columns...",
  "Almost there...",
];

type Props = {
  onFileSelected: (file: File) => void;
  isUploading: boolean;
  error: UploadError | null;
  onClearError: () => void;
  onPreflightError: (err: UploadError) => void;
};

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some((ext) => lower.endsWith(ext));
}

export function UploadZone({
  onFileSelected,
  isUploading,
  error,
  onClearError,
  onPreflightError,
}: Props) {
  const [progressIdx, setProgressIdx] = useState(0);

  useEffect(() => {
    if (!isUploading) {
      setProgressIdx(0);
      return;
    }
    const handle = window.setInterval(() => {
      setProgressIdx((i) => Math.min(i + 1, PROGRESS_MESSAGES.length - 1));
    }, 1500);
    return () => window.clearInterval(handle);
  }, [isUploading]);

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      if (!hasAllowedExtension(file.name)) {
        onPreflightError({
          message: "Only .csv, .xls, and .xlsx files are supported.",
        });
        return;
      }
      if (file.size > MAX_BYTES) {
        onPreflightError({
          message:
            "File is over 10 MB. Export a smaller slice or split it by team or quarter.",
        });
        return;
      }
      onClearError();
      onFileSelected(file);
    },
    [onClearError, onFileSelected, onPreflightError],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    disabled: isUploading,
  });

  const dragClasses = isDragActive
    ? "border-teal border-dashed bg-accent-bg"
    : "border-border";

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-md bg-health-red-bg border border-health-red/20 text-sm text-health-red px-3 py-2"
        >
          {error.message}
        </div>
      )}
      <div
        {...getRootProps()}
        className={`bg-surface border ${dragClasses} rounded-md min-h-[280px] flex flex-col items-center justify-center px-8 py-12 text-center transition-colors`}
      >
        <input {...getInputProps()} aria-label="Upload status file" />
        <div className="w-12 h-12 rounded-lg bg-gray-light flex items-center justify-center mb-4">
          {isUploading ? (
            <Loader2
              className="w-6 h-6 text-text-disabled animate-spin"
              aria-hidden
            />
          ) : (
            <UploadCloud className="w-6 h-6 text-text-disabled" aria-hidden />
          )}
        </div>
        <h2 className="text-base font-semibold text-text-primary mb-1">
          {isUploading ? PROGRESS_MESSAGES[progressIdx] : "Drop your file here"}
        </h2>
        <p className="text-sm text-text-muted mb-6 max-w-sm">
          {isUploading
            ? "Hold tight while we read your export."
            : "CSV, XLS, or XLSX up to 10 MB."}
        </p>
        <Button
          type="button"
          variant="default"
          onClick={open}
          disabled={isUploading}
        >
          {isUploading ? "Uploading..." : "Browse files"}
        </Button>
      </div>
    </div>
  );
}
