"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ocrPdf } from "@/lib/pdf/heavy-operations";
import type { OcrPageReport } from "@/lib/pdf/ocr-overlay";
import {
  analyzeTextLayer,
  applyOcrStatus,
  ocrProgress,
  pagesToOcr,
  type OcrMode,
  type OcrStatusMap,
  type PdfJsLike,
  type TextLayerSummary,
} from "@/lib/interpretation/text-layer";

export type OcrAnalysisState =
  | { state: "idle" }
  | { state: "loading"; done: number; total: number }
  | { state: "ready"; summary: TextLayerSummary }
  | { state: "error"; message: string };

export type OcrRunOutcome = {
  results: { filename: string; bytes: Uint8Array }[];
  message: string;
  tone: "success" | "error";
};

const pageList = (pages: number[]) => pages.map((p) => p + 1).join(", ");

/**
 * Scanned-PDF flow for the OCR tool: checks which pages of `file` have a text layer, recommends OCR for the ones that
 * do not, runs the existing ocrPdf on the chosen pages and tracks per-page OCR status. It never replaces the file:
 * `run` returns a new output for the caller to add to the results list.
 */
export function useOcrFlow(file: File | null, enabled: boolean, onProgressMessage?: (msg: string) => void) {
  const [analysis, setAnalysis] = useState<OcrAnalysisState>({ state: "idle" });
  const [mode, setMode] = useState<OcrMode>("scanned");
  const [ocrStatus, setOcrStatus] = useState<OcrStatusMap>({});
  const [reports, setReports] = useState<OcrPageReport[]>([]);
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setOcrStatus({});
    setReports([]);
    if (!enabled || !file) {
      setAnalysis({ state: "idle" });
      return;
    }
    let cancelled = false;
    setAnalysis({ state: "loading", done: 0, total: 0 });
    (async () => {
      try {
        const { pdfjs } = await import("react-pdf");
        pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const summary = await analyzeTextLayer(bytes, pdfjs as unknown as PdfJsLike, {
          onProgress: (done, total) => {
            if (!cancelled) setAnalysis({ state: "loading", done, total });
          },
        });
        if (!cancelled) setAnalysis({ state: "ready", summary });
      } catch (e) {
        if (!cancelled) setAnalysis({ state: "error", message: e instanceof Error ? e.message : "Could not check this PDF." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, enabled, attempt]);

  const summary = analysis.state === "ready" ? analysis.summary : null;
  const targets = useMemo(() => pagesToOcr(summary, mode), [summary, mode]);

  const disabledReason: string | null = !file
    ? "Add a PDF first."
    : running
    ? "OCR is running."
    : analysis.state === "loading"
    ? "Checking which pages have text..."
    : summary && targets && targets.length === 0
    ? summary.kind === "EMPTY"
      ? "This PDF has no pages."
      : "Every page already has text. Choose “All pages” to run OCR anyway."
    : null;

  const retryAnalysis = useCallback(() => setAttempt((n) => n + 1), []);

  /** Runs OCR on the chosen pages. Throws (OcrError or other) when nothing could be recognised at all. */
  const run = useCallback(async (): Promise<OcrRunOutcome> => {
    if (!file) throw new Error("Add a PDF first.");
    setRunning(true);
    setOcrStatus({});
    setReports([]);
    const collected: OcrPageReport[] = [];
    try {
      const results = await ocrPdf(file, onProgressMessage, {
        pages: targets,
        onPageStatus: (page, status, report) => {
          setOcrStatus((m) => applyOcrStatus(m, page, status));
          if (report) {
            collected.push(report);
            setReports([...collected]);
          }
        },
      });
      const failed = collected.filter((r) => r.status === "OCR_FAILED");
      const ok = collected.filter((r) => r.status === "OCR_COMPLETED");
      const empty = ok.filter((r) => r.words === 0).map((r) => r.pageIndex);
      if (failed.length) {
        return {
          results,
          tone: "error",
          message: `OCR finished with errors: page ${pageList(failed.map((r) => r.pageIndex))} failed. The output has the other ${ok.length} page(s).`,
        };
      }
      const note = empty.length ? ` No text was recognised on page ${pageList(empty)}.` : "";
      return { results, tone: "success", message: `OCR finished: ${ok.length} page(s) processed.${note}` };
    } finally {
      setRunning(false);
    }
  }, [file, targets, onProgressMessage]);

  const progress = useMemo(() => ocrProgress(ocrStatus, targets ?? summary?.pages.map((p) => p.pageIndex) ?? []), [ocrStatus, targets, summary]);

  return { analysis, summary, mode, setMode, targets, ocrStatus, reports, running, progress, disabledReason, retryAnalysis, run };
}

export type OcrFlow = ReturnType<typeof useOcrFlow>;
