"use client";

import clsx from "clsx";
import type { DocxQueueItem } from "@/lib/docx/types";
import { formatBytes } from "./docx-format";
import type { DocxValidationMap } from "./useDocxQueue";
import {
  DocxArrowDownIcon,
  DocxArrowUpIcon,
  DocxDocumentIcon,
  DocxTrashIcon,
} from "./DocxIcons";

interface DocxFileQueueProps {
  items: DocxQueueItem[];
  validation: DocxValidationMap;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  /** Set while a processor runs; queue changes would invalidate the running inputs. */
  disabled?: boolean;
  /** Queue entry the selected single-file tool will read. Null for merge. */
  activeItemId?: string | null;
}

const plural = (count: number) => (count === 1 ? "" : "s");

export function DocxFileQueue({
  items,
  validation,
  onRemove,
  onMove,
  disabled = false,
  activeItemId = null,
}: DocxFileQueueProps) {
  const validCount = items.filter((item) => validation[item.id]?.status === "valid").length;
  const invalidCount = items.filter(
    (item) => validation[item.id]?.status === "invalid"
  ).length;
  const checkingCount = items.length - validCount - invalidCount;

  const summary =
    items.length === 0
      ? null
      : checkingCount > 0
        ? `Checking ${checkingCount} file${plural(checkingCount)}\u2026`
        : invalidCount > 0
          ? `${invalidCount} file${plural(invalidCount)} need${
              invalidCount === 1 ? "s" : ""
            } attention.`
          : `All ${items.length} file${plural(items.length)} passed validation.`;

  return (
    <section aria-labelledby="docx-queue-heading" className="mt-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2
          id="docx-queue-heading"
          className="text-lg font-semibold tracking-tight text-slate-900"
        >
          File queue
        </h2>
        {items.length > 0 && (
          <p className="text-sm text-slate-500">
            {items.length} file{plural(items.length)} &middot; top to bottom is the working
            order
          </p>
        )}
      </div>

      {summary && (
        <p
          className={clsx(
            "mb-3 text-xs",
            invalidCount > 0 ? "text-red-700" : "text-slate-500"
          )}
        >
          {summary}
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
            <DocxDocumentIcon className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-slate-700">
            No documents in the queue yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
            Add DOCX files using the upload area above. They will appear here in the order
            you add them.
          </p>
        </div>
      ) : (
        <>
          <p id="docx-queue-order-help" className="sr-only">
            Use the move up and move down buttons on each file to change the queue order.
          </p>
          <ul
            aria-describedby="docx-queue-order-help"
            className="flex flex-col gap-2"
          >
            {items.map((item, index) => {
              const state = validation[item.id];
              const isChecking = state?.status === "checking" || state === undefined;
              const invalidMessage =
                state?.status === "invalid" ? state.message : null;

              return (
                <li
                  key={item.id}
                  className={clsx(
                    "rounded-lg border bg-white transition-colors",
                    invalidMessage ? "border-red-200" : "border-slate-200"
                  )}
                >
                  <div className="flex items-start gap-3 p-3 sm:items-center sm:p-4">
                    <span className="sr-only">
                      Position {index + 1} of {items.length}.
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 sm:mt-0"
                    >
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p
                        className="break-words text-sm font-medium text-slate-900 sm:truncate"
                        title={item.file.name}
                      >
                        {item.file.name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span className="whitespace-nowrap">
                          <span className="hidden sm:inline">Word document</span>
                          <span className="sm:hidden">DOCX</span>
                          <span aria-hidden="true"> &middot; </span>
                          {formatBytes(item.file.size)}
                        </span>
                        {item.id === activeItemId && (
                          <span className="font-medium text-layah-primary">
                            Used by this tool
                          </span>
                        )}
                        {isChecking && (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <span
                              aria-hidden="true"
                              className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-slate-600 motion-reduce:animate-none"
                            />
                            Checking&hellip;
                          </span>
                        )}
                        {invalidMessage && (
                          <span className="font-medium text-red-700">
                            Needs attention
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                      <button
                        type="button"
                        onClick={() => onMove(item.id, -1)}
                        disabled={disabled || index === 0}
                        aria-label={`Move ${item.file.name} up`}
                        title="Move up"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 sm:h-8 sm:w-8"
                      >
                        <DocxArrowUpIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(item.id, 1)}
                        disabled={disabled || index === items.length - 1}
                        aria-label={`Move ${item.file.name} down`}
                        title="Move down"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 sm:h-8 sm:w-8"
                      >
                        <DocxArrowDownIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        disabled={disabled}
                        aria-label={`Remove ${item.file.name}`}
                        title="Remove"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 sm:h-8 sm:w-8"
                      >
                        <DocxTrashIcon />
                      </button>
                    </div>
                  </div>

                  {invalidMessage && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="break-words border-t border-red-100 px-3 py-2 text-xs leading-relaxed text-red-700 sm:px-4"
                    >
                      {invalidMessage}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
