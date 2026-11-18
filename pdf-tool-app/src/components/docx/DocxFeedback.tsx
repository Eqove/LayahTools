"use client";

import type { DocxRejectedFile } from "@/lib/docx/types";
import { DocxAlertIcon, DocxCloseIcon } from "./DocxIcons";

interface DismissibleNoticeProps {
  onDismiss: () => void;
}

interface DocxStatusNoticeProps extends DismissibleNoticeProps {
  message: string | null;
}

/** Quiet confirmation for add, remove and reorder actions. Announced politely. */
export function DocxStatusNotice({ message, onDismiss }: DocxStatusNoticeProps) {
  if (!message) return null;

  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-3.5 py-2.5">
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss status message"
        className="-m-1 shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary"
      >
        <DocxCloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

interface DocxRejectedNoticeProps extends DismissibleNoticeProps {
  rejected: DocxRejectedFile[];
}

/** Per-file screening failures. Uses the helper's message; no local validation copy. */
export function DocxRejectedNotice({
  rejected,
  onDismiss,
}: DocxRejectedNoticeProps) {
  if (rejected.length === 0) return null;

  return (
    <div
      role="alert"
      className="mt-4 rounded-lg border border-red-200 bg-red-50/70 p-4"
    >
      <div className="flex items-start gap-3">
        <DocxAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-900">
            Some files were not added
          </p>
          <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-red-700">
            {rejected.map((file, index) => (
              <li key={`${file.name}-${index}`} className="break-words">
                <span className="font-medium">{file.name}</span> &mdash; {file.message}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss rejected files notice"
          className="-m-1 shrink-0 rounded p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <DocxCloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface DocxErrorNoticeProps extends DismissibleNoticeProps {
  message: string | null;
}

/** General queue failure, separate from a single file being invalid. */
export function DocxErrorNotice({ message, onDismiss }: DocxErrorNoticeProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="mt-4 rounded-lg border border-red-200 bg-red-50/70 p-4"
    >
      <div className="flex items-start gap-3">
        <DocxAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-900">Something went wrong</p>
          <p className="mt-1 break-words text-sm leading-relaxed text-red-700">
            {message}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="-m-1 shrink-0 rounded p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <DocxCloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
