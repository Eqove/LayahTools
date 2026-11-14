"use client";

import React from "react";

interface FileSizeWarningProps {
  fileName: string;
  fileSizeBytes: number;
  onDismiss: () => void;
  className?: string;
}

export function FileSizeWarning({
  fileName,
  fileSizeBytes,
  onDismiss,
  className = "",
}: FileSizeWarningProps) {
  const sizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);

  return (
    <div
      role="region"
      aria-label="Large file notice"
      className={`bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-3 ${className}`}
    >
      <div className="text-amber-600 shrink-0 mt-0.5">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-900">
          Large file detected ({sizeMb} MB) &mdash; {fileName}
        </p>
        <p className="text-amber-800/90 mt-0.5 leading-relaxed">
          All document processing runs 100% locally in your browser memory for privacy. Large files may take additional time or memory during complex operations.
        </p>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss file size notice"
        className="text-amber-700 hover:text-amber-950 p-1 rounded hover:bg-amber-100 transition-colors shrink-0"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

