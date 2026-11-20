"use client";

/**
 * DOCX processing state for the workspace.
 *
 * This hook only orchestrates the existing processors: it never re-implements extraction, text
 * conversion, metadata reading/removal or merging. Results are replaced atomically, late results
 * from a superseded run are ignored, and a run cannot overlap another run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertDocxToTxt, type DocxTxtConversion } from "@/lib/docx/docx-to-txt";
import { isDocxError, type DocxErrorCode } from "@/lib/docx/errors";
import { extractDocxText, type DocxTextExtraction } from "@/lib/docx/extract-text";
import { mergeDocxDocuments } from "@/lib/docx/merge";
import type { DocxMergedDocument } from "@/lib/docx/merge/types";
import { readDocxMetadata } from "@/lib/docx/metadata";
import {
  removeSupportedDocxMetadata,
  type DocxMetadataCleanup,
} from "@/lib/docx/remove-metadata";
import type {
  DocxMetadata,
  DocxProcessingResult,
  DocxQueueItem,
  DocxWarning,
} from "@/lib/docx/types";
import {
  getDocxUtilityReadiness,
  type DocxUtilityId,
  type DocxUtilityReadiness,
} from "./docx-utilities";
import type { DocxValidationMap } from "./useDocxQueue";

export interface DocxUtilityValueMap {
  "extract-text": DocxTextExtraction;
  "docx-to-txt": DocxTxtConversion;
  "inspect-metadata": DocxMetadata;
  "remove-metadata": DocxMetadataCleanup;
  merge: DocxMergedDocument;
}

/** Success state is a discriminated union so each result view receives its exact value type. */
export type DocxSuccessState = {
  [K in DocxUtilityId]: {
    status: "success";
    utility: K;
    value: DocxUtilityValueMap[K];
    /** Queue names captured when the run started. */
    sources: readonly string[];
    warnings: DocxWarning[];
  };
}[DocxUtilityId];

export type DocxProcessingState =
  | { status: "idle" }
  | { status: "processing"; utility: DocxUtilityId }
  | DocxSuccessState
  | {
      status: "error";
      utility: DocxUtilityId;
      message: string;
      code: DocxErrorCode | null;
      warnings: DocxWarning[];
    };

export interface DocxProcessing {
  state: DocxProcessingState;
  run: <K extends DocxUtilityId>(
    utility: K,
    sources: readonly string[],
    task: () => Promise<DocxProcessingResult<DocxUtilityValueMap[K]>>
  ) => Promise<void>;
  reset: () => void;
}

export function useDocxProcessing(): DocxProcessing {
  const [state, setState] = useState<DocxProcessingState>({ status: "idle" });
  const runCount = useRef(0);
  const busy = useRef(false);

  const reset = useCallback(() => {
    runCount.current += 1;
    busy.current = false;
    setState({ status: "idle" });
  }, []);

  const run = useCallback(
    async <K extends DocxUtilityId>(
      utility: K,
      sources: readonly string[],
      task: () => Promise<DocxProcessingResult<DocxUtilityValueMap[K]>>
    ) => {
      if (busy.current) return;

      busy.current = true;
      const runId = ++runCount.current;
      setState({ status: "processing", utility });

      try {
        const result = await task();
        if (runId !== runCount.current) return;

        if (result.ok) {
          // `utility` and `result.value` come from the same generic call, but TypeScript cannot
          // correlate the mapped union here, so the pair is asserted once at the boundary.
          setState({
            status: "success",
            utility,
            value: result.value,
            sources,
            warnings: result.warnings,
          } as DocxSuccessState);
        } else {
          setState({
            status: "error",
            utility,
            message: result.error.message,
            code: result.error.code,
            warnings: result.warnings,
          });
        }
      } catch (error) {
        if (runId !== runCount.current) return;
        const docxError = isDocxError(error) ? error : null;
        setState({
          status: "error",
          utility,
          message:
            docxError?.message ??
            "The document could not be processed. Your queue and files are unchanged.",
          code: docxError?.code ?? null,
          warnings: [],
        });
      } finally {
        if (runId === runCount.current) busy.current = false;
      }
    },
    []
  );

  return { state, run, reset };
}

export interface DocxUtilityController {
  state: DocxProcessingState;
  readiness: DocxUtilityReadiness;
  isProcessing: boolean;
  run: () => void;
  reset: () => void;
}

/**
 * Binds the selected utility to the current queue.
 *
 * The result is cleared whenever the tool or the queue inputs change, so a result can never be
 * mistaken for output of a different tool or a different file set.
 */
export function useDocxUtility(
  utility: DocxUtilityId,
  items: DocxQueueItem[],
  validation: DocxValidationMap
): DocxUtilityController {
  const { state, run: runTask, reset } = useDocxProcessing();

  const signature = items
    .map((item) => `${item.id}:${validation[item.id]?.status ?? "pending"}`)
    .join("|");

  useEffect(() => {
    reset();
  }, [utility, signature, reset]);

  const readiness = useMemo(
    () => getDocxUtilityReadiness(utility, items, validation),
    [utility, items, validation]
  );

  const run = useCallback(() => {
    if (!readiness.ready || state.status === "processing") return;

    const sources = items.map((item) => item.file.name);
    const first = items[0];

    if (utility === "merge") {
      const mergeSources = items.map((item) => ({ input: item.file }));
      void runTask("merge", sources, () => mergeDocxDocuments(mergeSources));
      return;
    }

    if (!first) return;

    switch (utility) {
      case "extract-text":
        void runTask("extract-text", sources, () => extractDocxText(first.file));
        break;
      case "docx-to-txt":
        void runTask("docx-to-txt", sources, () => convertDocxToTxt(first.file));
        break;
      case "inspect-metadata":
        void runTask("inspect-metadata", sources, () => readDocxMetadata(first.file));
        break;
      case "remove-metadata":
        void runTask("remove-metadata", sources, () =>
          removeSupportedDocxMetadata(first.file)
        );
        break;
    }
  }, [items, readiness.ready, runTask, state.status, utility]);

  return {
    state,
    readiness,
    isProcessing: state.status === "processing",
    run,
    reset,
  };
}
