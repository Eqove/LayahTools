"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DocxWarning } from "@/lib/docx/types";
import { downloadBlob } from "./docx-download";
import { uniqueDocxWarnings } from "./docx-warnings";
import {
  DocxAlertIcon,
  DocxCheckIcon,
  DocxCopyIcon,
  DocxDownloadIcon,
} from "./DocxIcons";

/** Shared warning presentation for every utility result and for processing failures. */
export function DocxWarningList({
  warnings,
  className = "",
}: {
  warnings: readonly DocxWarning[];
  className?: string;
}) {
  const unique = uniqueDocxWarnings(warnings);
  if (unique.length === 0) return null;

  return (
    <section
      aria-label="Warnings"
      className={clsx(
        "rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-amber-900",
        className
      )}
    >
      <div className="flex gap-2.5">
        <DocxAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {unique.length === 1 ? "Warning" : "Warnings"}
          </h3>
          <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed">
            {unique.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="break-words">
                {warning.message}
                {warning.detail && (
                  <span className="mt-0.5 block break-words text-xs text-amber-800/90">
                    {warning.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

interface DocxResultShellProps {
  title: string;
  description?: string;
  warnings?: readonly DocxWarning[];
  children: ReactNode;
  className?: string;
}

/** Card used by every successful result. The heading id keeps the region label unique. */
export function DocxResultShell({
  title,
  description,
  warnings = [],
  children,
  className = "",
}: DocxResultShellProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={clsx("rounded-xl border border-slate-200 bg-white p-4 sm:p-6", className)}
    >
      <h3 id={headingId} className="text-base font-semibold text-slate-900">
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
      )}

      <div className="mt-4">{children}</div>

      <DocxWarningList warnings={warnings} className="mt-4" />
    </section>
  );
}

export interface DocxStat {
  label: string;
  value: string;
}

/** Compact stat grid used by the extraction, conversion, cleanup and merge results. */
export function DocxStatGrid({
  stats,
  className = "",
}: {
  stats: readonly DocxStat[];
  className?: string;
}) {
  return (
    <dl
      className={clsx(
        "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3",
        className
      )}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5"
        >
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {stat.label}
          </dt>
          <dd className="mt-1 break-words text-sm font-semibold text-slate-900">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Label/value rows for conversion details and removal summaries. */
export function DocxFactList({
  rows,
  className = "",
}: {
  rows: readonly { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={clsx(
        "divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200",
        className
      )}
    >
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className="grid gap-0.5 bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-baseline sm:gap-4"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {row.label}
          </dt>
          <dd className="min-w-0 break-words text-sm text-slate-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface DocxDownloadButtonProps {
  blob: Blob;
  fileName: string;
  label: string;
  className?: string;
}

export function DocxDownloadButton({
  blob,
  fileName,
  label,
  className = "",
}: DocxDownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={() => downloadBlob(blob, fileName)}
      aria-label={`${label} (${fileName})`}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg bg-layah-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-layah-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2",
        className
      )}
    >
      <DocxDownloadIcon />
      {label}
    </button>
  );
}

/** Copy action for extracted text. Falls back to a clear message if the Clipboard API is blocked. */
export function DocxCopyButton({
  text,
  disabled = false,
}: {
  text: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const handleCopy = async () => {
    clearTimer();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }

    timer.current = window.setTimeout(() => {
      timer.current = null;
      setStatus("idle");
    }, 4000);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleCopy}
        disabled={disabled}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <DocxCopyIcon />
        {status === "copied" ? "Copied" : "Copy text"}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-slate-600">
        {status === "copied"
          ? "Copied to clipboard."
          : status === "failed"
            ? "Copy failed. Select the text and copy it manually."
            : ""}
      </span>
    </span>
  );
}

export interface DocxCheck {
  label: string;
  ok: boolean;
}

/** Verification facts reported by the cleanup and merge processors. */
export function DocxCheckList({
  checks,
  title = "Verified",
}: {
  checks: readonly DocxCheck[];
  title?: string;
}) {
  const allOk = checks.every((check) => check.ok);

  return (
    <section aria-label={title}>
      <h4
        className={clsx(
          "text-sm font-semibold",
          allOk ? "text-emerald-800" : "text-amber-800"
        )}
      >
        {allOk ? title : `${title} with exceptions`}
      </h4>
      <ul className="mt-2 space-y-1.5 text-sm">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={clsx(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                check.ok
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              )}
            >
              {check.ok ? (
                <DocxCheckIcon className="h-3 w-3" />
              ) : (
                <span className="text-[10px] font-bold">!</span>
              )}
            </span>
            <span className={check.ok ? "text-slate-600" : "text-amber-800"}>
              {check.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Typed failure display. `warnings` carries merge findings collected before the failure. */
export function DocxProcessingError({
  message,
  warnings,
}: {
  message: string;
  warnings: readonly DocxWarning[];
}) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50/70 p-4">
      <div className="flex items-start gap-3">
        <DocxAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-red-900">
            This action could not be completed
          </h3>
          <p className="mt-1 break-words text-sm leading-relaxed text-red-700">
            {message}
          </p>
          <p className="mt-1 text-xs text-red-700/90">
            No output file was created. Your queue and uploaded files are unchanged.
          </p>
          <DocxWarningList warnings={warnings} className="mt-3" />
        </div>
      </div>
    </div>
  );
}
