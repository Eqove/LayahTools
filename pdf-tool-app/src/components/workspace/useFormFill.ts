"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildFilename } from "@/lib/pdf/operations";
import { FormError, fillForm, readFormFields, validateFormValues, type FieldError, type FieldValue, type FormFieldInfo, type FormInfo, type FormValues } from "@/lib/pdf/forms";

export type FormAnalysis =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; info: FormInfo }
  | { state: "error"; message: string; code?: string };

export type FormFillOutcome = {
  results: { filename: string; bytes: Uint8Array }[];
  message: string;
  tone: "success" | "error";
};

const same = (a: FieldValue, b: FieldValue) => (Array.isArray(a) && Array.isArray(b) ? [...a].sort().join("\u0000") === [...b].sort().join("\u0000") : a === b);

/**
 * Form-filling flow: lists the fields of `file`, keeps the user's edits as a draft (only changed fields), validates them
 * live and writes them to a NEW output on run. The source file is never replaced.
 */
export function useFormFill(file: File | null, enabled: boolean) {
  const [analysis, setAnalysis] = useState<FormAnalysis>({ state: "idle" });
  const [draft, setDraft] = useState<FormValues>({});
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setDraft({});
    if (!enabled || !file) {
      setAnalysis({ state: "idle" });
      return;
    }
    let cancelled = false;
    setAnalysis({ state: "loading" });
    (async () => {
      try {
        const info = await readFormFields(new Uint8Array(await file.arrayBuffer()));
        if (!cancelled) setAnalysis({ state: "ready", info });
      } catch (e) {
        if (!cancelled) setAnalysis({ state: "error", message: e instanceof Error ? e.message : "Could not read this PDF.", code: e instanceof FormError ? e.code : undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, enabled, attempt]);

  const info = analysis.state === "ready" ? analysis.info : null;
  const fields: FormFieldInfo[] = useMemo(() => info?.fields ?? [], [info]);

  /** Only the fields whose draft differs from what the file already holds. */
  const changes: FormValues = useMemo(() => {
    const out: FormValues = {};
    for (const f of fields) if (f.name in draft && !same(draft[f.name], f.value)) out[f.name] = draft[f.name];
    return out;
  }, [draft, fields]);
  const changedCount = Object.keys(changes).length;

  const errors: FieldError[] = useMemo(() => validateFormValues(fields, changes), [fields, changes]);
  const errorFor = useCallback((name: string) => errors.find((e) => e.name === name)?.message, [errors]);

  const setValue = useCallback((name: string, value: FieldValue) => setDraft((d) => ({ ...d, [name]: value })), []);
  const reset = useCallback(() => setDraft({}), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const disabledReason: string | null = !file
    ? "Add a PDF first."
    : running
    ? "Filling the form..."
    : analysis.state === "loading"
    ? "Reading the form fields..."
    : analysis.state === "error"
    ? analysis.message
    : info && (!info.hasAcroForm || fields.length === 0)
    ? "This PDF has no fillable form fields."
    : info && !fields.some((f) => f.supported && !f.readOnly)
    ? "None of this form's fields can be filled (all are read-only or unsupported)."
    : changedCount === 0
    ? "Enter a value in at least one field."
    : errors.length > 0
    ? `Fix ${errors.length} field${errors.length > 1 ? "s" : ""} first.`
    : null;

  /** Writes the changed fields to a new PDF, reopens it and verifies every value. Throws FormError on failure. */
  const run = useCallback(async (): Promise<FormFillOutcome> => {
    if (!file) throw new Error("Add a PDF first.");
    setRunning(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await fillForm(bytes, changes);
      const skipped = fields.filter((f) => !f.supported).length;
      const note = skipped ? ` ${skipped} unsupported field${skipped > 1 ? "s were" : " was"} left as is.` : "";
      return {
        results: [{ filename: buildFilename(file.name, "filled"), bytes: result.bytes }],
        message: `Form filled: ${result.verification.length} field${result.verification.length > 1 ? "s" : ""} written and verified after reopening.${note}`,
        tone: "success",
      };
    } finally {
      setRunning(false);
    }
  }, [file, changes, fields]);

  return { analysis, info, fields, draft, setValue, reset, retry, changedCount, errors, errorFor, running, disabledReason, run };
}

export type FormFillFlow = ReturnType<typeof useFormFill>;
