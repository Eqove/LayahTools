"use client";

import { useCallback, useEffect, useState } from "react";
import { buildFilename } from "@/lib/pdf/operations";
import { FormError, flattenForm, inspectForFlatten, type FlattenInspection, type FlattenReport } from "@/lib/pdf/forms";

export type FlattenAnalysis =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; inspection: FlattenInspection }
  | { state: "error"; message: string; code?: string };

export type FlattenOutcome = {
  results: { filename: string; bytes: Uint8Array }[];
  message: string;
  tone: "success" | "error";
};

/**
 * Flatten flow: inspects the file (fields, widgets, other annotations), requires an explicit confirmation, then writes a
 * NEW flattened copy. The source file is never replaced. Flattening affects AcroForm fields only; other annotations are
 * kept as they are and reported.
 */
export function useFlattenForm(file: File | null, enabled: boolean) {
  const [analysis, setAnalysis] = useState<FlattenAnalysis>({ state: "idle" });
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<FlattenReport | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setConfirmed(false);
    setReport(null);
    if (!enabled || !file) {
      setAnalysis({ state: "idle" });
      return;
    }
    let cancelled = false;
    setAnalysis({ state: "loading" });
    (async () => {
      try {
        const inspection = await inspectForFlatten(new Uint8Array(await file.arrayBuffer()));
        if (!cancelled) setAnalysis({ state: "ready", inspection });
      } catch (e) {
        if (!cancelled) setAnalysis({ state: "error", message: e instanceof Error ? e.message : "Could not read this PDF.", code: e instanceof FormError ? e.code : undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, enabled, attempt]);

  const inspection = analysis.state === "ready" ? analysis.inspection : null;
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const disabledReason: string | null = !file
    ? "Add a PDF first."
    : running
    ? "Flattening..."
    : analysis.state === "loading"
    ? "Checking the form fields..."
    : analysis.state === "error"
    ? analysis.message
    : inspection && inspection.fieldCount === 0
    ? "This PDF has no form fields to flatten."
    : !confirmed
    ? "Confirm that you understand the result cannot be edited as a form."
    : null;

  /** Flattens, reopens the output and verifies it. Throws FormError on failure. */
  const run = useCallback(async (): Promise<FlattenOutcome> => {
    if (!file) throw new Error("Add a PDF first.");
    if (!confirmed) throw new Error("Confirm the flattening first.");
    setRunning(true);
    try {
      const { bytes, report: r } = await flattenForm(new Uint8Array(await file.arrayBuffer()));
      setReport(r);
      const kept = r.annotationsKept ? ` ${r.annotationsKept} other annotation${r.annotationsKept > 1 ? "s were" : " was"} kept and not flattened.` : "";
      return {
        results: [{ filename: buildFilename(file.name, "flattened"), bytes }],
        message: `Flattened ${r.fieldsFlattened} field${r.fieldsFlattened === 1 ? "" : "s"}; the copy was reopened and verified.${kept}`,
        tone: "success",
      };
    } finally {
      setRunning(false);
    }
  }, [file, confirmed]);

  return { analysis, inspection, confirmed, setConfirmed, report, running, disabledReason, retry, run };
}

export type FlattenFlow = ReturnType<typeof useFlattenForm>;
