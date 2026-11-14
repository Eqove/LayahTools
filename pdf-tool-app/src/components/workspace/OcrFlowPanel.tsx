"use client";

import clsx from "clsx";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ErrorState } from "@/components/ui/ErrorState";
import { pageStatusView, type PageStatus } from "@/lib/interpretation/text-layer";
import type { OcrFlow } from "./useOcrFlow";

const LABEL: Record<PageStatus, string> = {
  TEXT_AVAILABLE: "Text",
  SCANNED_PAGE: "Scanned",
  MIXED_CONTENT: "Text + image",
  OCR_PROCESSING: "OCR running",
  OCR_COMPLETED: "OCR done",
  OCR_FAILED: "OCR failed",
};

const TONE: Record<PageStatus, string> = {
  TEXT_AVAILABLE: "border-slate-200 bg-slate-50 text-slate-600",
  SCANNED_PAGE: "border-amber-300 bg-amber-50 text-amber-800",
  MIXED_CONTENT: "border-sky-200 bg-sky-50 text-sky-800",
  OCR_PROCESSING: "border-blue-300 bg-blue-50 text-blue-800 animate-pulse",
  OCR_COMPLETED: "border-green-300 bg-green-50 text-green-800",
  OCR_FAILED: "border-red-300 bg-red-50 text-red-800",
};

const pages = (list: number[]) => list.map((p) => p + 1).join(", ");

/** Right-hand panel for the OCR tool: text-layer check, per-page status, OCR scope, progress and errors. */
export function OcrFlowPanel({ flow }: { flow: OcrFlow }) {
  const { analysis, summary, mode, setMode, ocrStatus, reports, running, progress, disabledReason } = flow;
  const failedReports = reports.filter((r) => r.status === "OCR_FAILED");

  return (
    <section aria-label="Scanned PDF check" className="flex flex-col gap-3 text-sm text-slate-700">
      {analysis.state === "loading" && (
        <div role="status" aria-live="polite" className="border border-slate-200 bg-slate-50 rounded-md p-3 flex flex-col gap-2">
          <span className="text-xs text-slate-600">Checking which pages have text...</span>
          <ProgressBar current={analysis.done} total={analysis.total || 1} label="Checking pages" unit="pages" className="max-w-none" />
        </div>
      )}

      {analysis.state === "error" && (
        <>
          <ErrorState title="Could not check this PDF" message={analysis.message} onRetry={flow.retryAnalysis} />
          <p className="text-xs text-slate-500">You can still run OCR; it will process every page.</p>
        </>
      )}

      {summary && (
        <>
          <div
            role="status"
            data-kind={summary.kind}
            className={clsx(
              "border rounded-md p-3",
              summary.kind === "TEXT" ? "border-green-200 bg-green-50 text-green-900" : summary.kind === "EMPTY" ? "border-slate-200 bg-slate-50" : "border-amber-300 bg-amber-50 text-amber-900"
            )}
          >
            {summary.kind === "TEXT" && <>All {summary.pageCount} page(s) have a text layer, so OCR is not needed.</>}
            {summary.kind === "SCANNED" && <>No text layer found: all {summary.pageCount} page(s) look like scanned images. Run OCR to make them searchable.</>}
            {summary.kind === "MIXED" && (
              <>
                {summary.scannedPages.length} of {summary.pageCount} page(s) have no text (page {pages(summary.scannedPages)}). Run OCR on just those pages.
              </>
            )}
            {summary.kind === "EMPTY" && <>This PDF has no pages.</>}
          </div>

          {summary.pages.some((p) => p.blank) && (
            <p className="text-xs text-slate-500">
              Page {pages(summary.pages.filter((p) => p.blank).map((p) => p.pageIndex))} has no text and no image that could be detected; it may be blank, so OCR may find nothing.
            </p>
          )}
          {summary.mixedPages.length > 0 && (
            <p className="text-xs text-slate-500">
              Page {pages(summary.mixedPages)} has a text layer on top of a full-page image (likely already recognised); OCR is optional there.
            </p>
          )}

          <ul className="grid grid-cols-3 gap-1.5" aria-label="Page status">
            {pageStatusView(summary, ocrStatus).map((p) => (
              <li
                key={p.pageIndex}
                data-status={p.status}
                title={p.status}
                className={clsx("border rounded px-1.5 py-1 text-[11px] leading-tight flex flex-col", TONE[p.status])}
              >
                <span className="font-semibold">Page {p.pageIndex + 1}</span>
                <span>{LABEL[p.status]}</span>
              </li>
            ))}
          </ul>

          <fieldset className="flex flex-col gap-1.5" disabled={running}>
            <legend className="text-xs font-semibold text-slate-600 mb-1">Pages to OCR</legend>
            <label className="flex items-center gap-2 text-xs">
              <input type="radio" name="ocr-mode" checked={mode === "scanned"} onChange={() => setMode("scanned")} />
              Scanned pages only ({summary.scannedPages.length})
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="radio" name="ocr-mode" checked={mode === "all"} onChange={() => setMode("all")} />
              All pages ({summary.pageCount}), including pages that already have text
            </label>
          </fieldset>
        </>
      )}

      {running && (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <ProgressBar current={progress.done} total={progress.total || 1} label="OCR progress" unit="pages" className="max-w-none" />
        </div>
      )}

      {failedReports.length > 0 && (
        <div role="alert" className="border border-red-200 bg-red-50 rounded-md p-3 text-xs text-red-800 flex flex-col gap-1">
          <strong>OCR failed on {failedReports.length} page(s)</strong>
          {failedReports.map((r) => (
            <span key={r.pageIndex}>{r.error}</span>
          ))}
        </div>
      )}

      {disabledReason && !running && <p className="text-xs text-slate-500">{disabledReason}</p>}

      <p className="text-xs text-slate-500">
        OCR runs in your browser using Tesseract. Your file is not changed: the searchable copy is added to Outputs as a new file.
      </p>
    </section>
  );
}
