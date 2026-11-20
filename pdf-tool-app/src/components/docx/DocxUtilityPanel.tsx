"use client";

import { useEffect, useRef, useState } from "react";
import {
  DOCX_APPLICATION_FIELDS,
  DOCX_CORE_FIELDS,
} from "./docx-fields";
import type { DocxUtilityReadiness, DocxUtilityId } from "./docx-utilities";
import { getDocxConfirmationToken, getDocxUtility } from "./docx-utilities";
import { DocxAlertIcon } from "./DocxIcons";
import { DocxProcessingError } from "./DocxResultParts";
import { DocxUtilityResult } from "./DocxUtilityResult";
import type { DocxProcessingState } from "./useDocxUtility";

interface DocxUtilityPanelProps {
  utility: DocxUtilityId;
  state: DocxProcessingState;
  readiness: DocxUtilityReadiness;
  itemCount: number;
  isProcessing: boolean;
  onRun: () => void;
  className?: string;
}

/** Supported removal coverage, derived from the same field list the result view uses. */
function RemovalScope() {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
      <h3 className="text-sm font-semibold text-slate-900">
        Supported properties this removes
      </h3>
      <dl className="mt-2 space-y-2 text-sm">
        <div>
          <dt className="font-medium text-slate-700">Document properties</dt>
          <dd className="mt-0.5 leading-relaxed text-slate-600">
            {DOCX_CORE_FIELDS.map((field) => field.label).join(", ")}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Application properties</dt>
          <dd className="mt-0.5 leading-relaxed text-slate-600">
            {DOCX_APPLICATION_FIELDS.map((field) => field.label).join(", ")}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Custom properties, thumbnails, comments, tracked changes and other parts are left
        untouched. This is not complete anonymization.
      </p>
    </div>
  );
}

export function DocxUtilityPanel({
  utility,
  state,
  readiness,
  itemCount,
  isProcessing,
  onRun,
  className = "",
}: DocxUtilityPanelProps) {
  const definition = getDocxUtility(utility);

  // A confirmation is tied to the tool and queue entry it was opened for. Deriving this
  // instead of resetting it in an effect means a queue or tool change closes it automatically,
  // and replacing the file with a same-named upload cannot inherit it.
  const confirmToken = getDocxConfirmationToken(utility, readiness);
  const [confirmingToken, setConfirmingToken] = useState<string | null>(null);
  const confirming = !isProcessing && confirmingToken === confirmToken;

  const actionRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Opening the confirmation moves focus to its primary action; cancelling returns focus to the
  // trigger. Confirming starts processing, where the action button no longer exists.
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    } else if (wasConfirming.current) {
      actionRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  const workingLine =
    utility === "merge"
      ? itemCount > 1
        ? `Merging ${itemCount} documents. Top to bottom is merge order.`
        : "Add at least two documents; queue order becomes merge order."
      : readiness.workingFileName
        ? `Using the first file in the queue: ${readiness.workingFileName}`
        : "Add a file to the queue to choose the working document.";

  const reasonId = "docx-action-reason";
  const confirmHeadingId = "docx-remove-confirm-heading";

  return (
    <section aria-labelledby="docx-action-heading" className={className}>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-layah-primary">
              Selected tool
            </p>
            <h2
              id="docx-action-heading"
              className="mt-1 text-lg font-semibold tracking-tight text-slate-900"
            >
              {definition.label}
            </h2>
          </div>
          <span className="shrink-0 self-start rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {definition.requirementLabel}
          </span>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {definition.description}
        </p>

        <p className="mt-3 break-words text-sm text-slate-700">{workingLine}</p>

        {utility === "remove-metadata" && <RemovalScope />}

        {!readiness.ready && readiness.reason && (
          <p
            id={reasonId}
            role="status"
            className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-600"
          >
            <DocxAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>{readiness.reason}</span>
          </p>
        )}

        {isProcessing ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-layah-primary motion-reduce:animate-none"
            />
            <span className="text-sm text-slate-700">
              {definition.processingLabel} This runs in your browser; keep this tab open.
            </span>
          </div>
        ) : confirming ? (
          <div
            role="group"
            aria-labelledby={confirmHeadingId}
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3.5"
          >
            <h3 id={confirmHeadingId} className="text-sm font-semibold text-amber-900">
              Remove supported metadata?
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-amber-900">
              A new copy will be created with the supported document and application properties
              removed. Your uploaded file is not changed. Unsupported metadata may remain.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                ref={confirmRef}
                type="button"
                onClick={() => {
                  setConfirmingToken(null);
                  onRun();
                }}
                className="inline-flex items-center justify-center rounded-lg bg-layah-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-layah-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2"
              >
                Yes, remove supported metadata
              </button>
              <button
                type="button"
                onClick={() => setConfirmingToken(null)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <button
              ref={actionRef}
              type="button"
              onClick={() => {
                if (utility === "remove-metadata") setConfirmingToken(confirmToken);
                else onRun();
              }}
              disabled={!readiness.ready}
              aria-describedby={!readiness.ready ? reasonId : undefined}
              className="inline-flex items-center justify-center rounded-lg bg-layah-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-layah-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {definition.actionLabel}
            </button>
          </div>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {state.status === "success"
            ? `${definition.label} finished. Results are below.`
            : ""}
        </p>
      </div>

      {state.status === "error" && (
        <div className="mt-4">
          <DocxProcessingError message={state.message} warnings={state.warnings} />
        </div>
      )}

      {state.status === "success" && (
        <div className="mt-4">
          <DocxUtilityResult state={state} />
        </div>
      )}
    </section>
  );
}
