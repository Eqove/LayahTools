/**
 * DOCX workspace utility model and readiness rules.
 *
 * Pure data and pure functions: no React, no DOM, no PDF imports. The UI uses this to describe
 * the five tools and to decide whether their action can run against the current queue.
 */

export const DOCX_UTILITY_IDS = [
  "extract-text",
  "docx-to-txt",
  "inspect-metadata",
  "remove-metadata",
  "merge",
] as const;

export type DocxUtilityId = (typeof DOCX_UTILITY_IDS)[number];

export interface DocxUtilityDefinition {
  id: DocxUtilityId;
  /** Short name used in the selector and the action panel heading. */
  label: string;
  /** One-line summary shown on the selector card. */
  summary: string;
  /** Longer explanation shown in the action panel. */
  description: string;
  /** Verb phrase on the primary action button. */
  actionLabel: string;
  /** Number of queue entries the tool reads. */
  fileRequirement: "one" | "many";
  /** Human-readable requirement, e.g. "1 DOCX file". */
  requirementLabel: string;
  /** Live status text while the processor runs. */
  processingLabel: string;
}

export const DOCX_UTILITIES: readonly DocxUtilityDefinition[] = [
  {
    id: "extract-text",
    label: "Extract text",
    summary: "Read the text of one Word document.",
    description:
      "Extracts readable text from the first document in the queue. Formatting, images and layout are not reproduced.",
    actionLabel: "Extract text",
    fileRequirement: "one",
    requirementLabel: "1 DOCX file",
    processingLabel: "Extracting text\u2026",
  },
  {
    id: "docx-to-txt",
    label: "DOCX to TXT",
    summary: "Convert one Word document to plain text.",
    description:
      "Creates a UTF-8 plain-text file from the first document in the queue, using the existing DOCX to TXT converter.",
    actionLabel: "Convert to TXT",
    fileRequirement: "one",
    requirementLabel: "1 DOCX file",
    processingLabel: "Converting to TXT\u2026",
  },
  {
    id: "inspect-metadata",
    label: "Inspect metadata",
    summary: "Review the properties stored in one Word file.",
    description:
      "Reads the supported core and application properties from the first document in the queue. Other metadata is outside this tool's coverage.",
    actionLabel: "Inspect properties",
    fileRequirement: "one",
    requirementLabel: "1 DOCX file",
    processingLabel: "Reading document properties\u2026",
  },
  {
    id: "remove-metadata",
    label: "Remove metadata",
    summary: "Remove supported properties from a copy.",
    description:
      "Creates a new copy of the first document in the queue with its supported core and application properties removed. Your uploaded file is not changed.",
    actionLabel: "Remove metadata",
    fileRequirement: "one",
    requirementLabel: "1 DOCX file",
    processingLabel: "Removing document properties\u2026",
  },
  {
    id: "merge",
    label: "Merge documents",
    summary: "Join two or more Word documents in queue order.",
    description:
      "Combines every document in the queue, top to bottom, into a new DOCX. The first document supplies the host layout; content the merge cannot preserve fails the merge instead of being dropped.",
    actionLabel: "Merge documents",
    fileRequirement: "many",
    requirementLabel: "2+ DOCX files",
    processingLabel: "Merging documents\u2026",
  },
];

export const getDocxUtility = (id: DocxUtilityId): DocxUtilityDefinition =>
  DOCX_UTILITIES.find((utility) => utility.id === id) ?? DOCX_UTILITIES[0];

/** Minimal structural shapes so the readiness rules stay free of React and queue state. */
export type DocxUtilityItem = { id: string; file: { name: string } };
export type DocxUtilityValidation =
  | { status: "checking" }
  | { status: "valid" }
  | { status: "invalid"; message: string };

export interface DocxUtilityReadiness {
  ready: boolean;
  /** Why the action cannot run yet. Null when ready. */
  reason: string | null;
  /** Number of queue entries the action will read. */
  targetCount: number;
  /** First queued document, for single-file tools. Null for an empty queue. */
  workingFileName: string | null;
  /**
   * Queue identity of that document. Names are not unique (the same file can be removed and
   * replaced), so confirmations are keyed by this id rather than by `workingFileName`.
   */
  workingItemId: string | null;
}

/**
 * Identity of a pending confirmation.
 *
 * Includes the queue entry id: a different upload that reuses the same file name must not inherit
 * a confirmation the user opened for the file it replaced.
 */
export const getDocxConfirmationToken = (
  utility: DocxUtilityId,
  readiness: DocxUtilityReadiness
): string => `${utility}|${readiness.ready}|${readiness.workingItemId ?? ""}`;

/**
 * Decides whether the selected tool can run.
 *
 * Single-file tools deliberately read the first queue entry rather than guessing which file the
 * user meant, so the active document is stable and visible. Merge reads every entry in order.
 */
export function getDocxUtilityReadiness(
  utility: DocxUtilityId,
  items: readonly DocxUtilityItem[],
  validation: Readonly<Partial<Record<string, DocxUtilityValidation>>>
): DocxUtilityReadiness {
  const first = items[0];
  const workingFileName = first?.file.name ?? null;
  const workingItemId = first?.id ?? null;

  if (utility === "merge") {
    if (items.length === 0) {
      return {
        ready: false,
        reason: "Add at least two DOCX files to merge.",
        targetCount: 0,
        workingFileName,
        workingItemId,
      };
    }
    if (items.length === 1) {
      return {
        ready: false,
        reason: "Add another DOCX file. Merging needs at least two documents.",
        targetCount: 1,
        workingFileName,
        workingItemId,
      };
    }

    const invalid = items.find((item) => validation[item.id]?.status === "invalid");
    if (invalid) {
      return {
        ready: false,
        reason: `\u201c${invalid.file.name}\u201d failed validation. Remove or replace it before merging.`,
        targetCount: items.length,
        workingFileName,
        workingItemId,
      };
    }

    const pending = items.find((item) => validation[item.id]?.status !== "valid");
    if (pending) {
      return {
        ready: false,
        reason: "Waiting for every queued file to finish checking.",
        targetCount: items.length,
        workingFileName,
        workingItemId,
      };
    }

    return { ready: true, reason: null, targetCount: items.length, workingFileName, workingItemId };
  }

  if (!first) {
    return {
      ready: false,
      reason: "Add a DOCX file to the queue first.",
      targetCount: 0,
      workingFileName: null,
      workingItemId: null,
    };
  }

  const state = validation[first.id];
  if (state?.status === "invalid") {
    return {
      ready: false,
      reason: `The first file in the queue failed validation: ${state.message}`,
      targetCount: 1,
      workingFileName,
      workingItemId,
    };
  }
  if (state?.status !== "valid") {
    return {
      ready: false,
      reason: "Waiting for the first file to finish checking.",
      targetCount: 1,
      workingFileName,
      workingItemId,
    };
  }

  return { ready: true, reason: null, targetCount: 1, workingFileName, workingItemId };
}
