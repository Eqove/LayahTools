/**
 * DOCX workspace UI-level tests.
 *
 * The workspace components hold the processing state, but the rules that decide what a tool can
 * run against, and the labels/counts it shows, are pure functions. Those are tested here without
 * a DOM so regressions surface in the normal `test:docx` run.
 */

import {
  DOCX_UTILITY_IDS,
  DOCX_UTILITIES,
  getDocxConfirmationToken,
  getDocxUtility,
  getDocxUtilityReadiness,
  type DocxUtilityValidation,
} from "../src/components/docx/docx-utilities";
import {
  formatBytes,
  formatCount,
  formatMetadataDate,
} from "../src/components/docx/docx-format";
import {
  DOCX_APPLICATION_FIELDS,
  DOCX_CORE_FIELDS,
  DOCX_FIELD_LABELS,
  getDocxFieldLabel,
} from "../src/components/docx/docx-fields";
import { uniqueDocxWarnings } from "../src/components/docx/docx-warnings";
import type { DocxMetadata, DocxWarning } from "../src/lib/docx/types";

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};

const item = (id: string, name: string) => ({ id, file: { name } });
const valid: DocxUtilityValidation = { status: "valid" };
const pending: DocxUtilityValidation = { status: "checking" };
const invalid = (message: string): DocxUtilityValidation => ({
  status: "invalid",
  message,
});

const metadataFields: (keyof DocxMetadata)[] = [
  "title",
  "subject",
  "creator",
  "description",
  "keywords",
  "lastModifiedBy",
  "revision",
  "category",
  "created",
  "modified",
  "application",
  "applicationVersion",
  "company",
  "manager",
  "pages",
  "words",
  "characters",
];

// =========================================================================
// UTILITY MODEL
// =========================================================================

check("five utilities are defined", DOCX_UTILITIES.length === 5);
check(
  "utility ids match the declared id list",
  DOCX_UTILITIES.every((utility, index) => utility.id === DOCX_UTILITY_IDS[index])
);
check(
  "utility ids are unique",
  new Set(DOCX_UTILITY_IDS).size === DOCX_UTILITY_IDS.length
);
check(
  "every utility has user-facing copy",
  DOCX_UTILITIES.every(
    (utility) =>
      utility.label.length > 0 &&
      utility.summary.length > 0 &&
      utility.description.length > 0 &&
      utility.actionLabel.length > 0 &&
      utility.processingLabel.length > 0 &&
      utility.requirementLabel.length > 0
  )
);
check(
  "only merge needs more than one file",
  DOCX_UTILITIES.filter((utility) => utility.fileRequirement === "many").map(
    (utility) => utility.id
  ).join(",") === "merge"
);
check(
  "getDocxUtility returns the requested definition",
  DOCX_UTILITY_IDS.every((id) => getDocxUtility(id).id === id)
);

// =========================================================================
// READINESS
// =========================================================================

const emptySingle = getDocxUtilityReadiness("extract-text", [], {});
check("single-file tool is blocked on an empty queue", !emptySingle.ready);
check(
  "empty single-file reason asks for a file",
  emptySingle.reason === "Add a DOCX file to the queue first."
);
check("empty single-file tool targets no files", emptySingle.targetCount === 0);

const emptyMerge = getDocxUtilityReadiness("merge", [], {});
check("merge is blocked on an empty queue", !emptyMerge.ready);
check(
  "empty merge reason asks for two files",
  emptyMerge.reason === "Add at least two DOCX files to merge."
);

const checking = getDocxUtilityReadiness("docx-to-txt", [item("1", "a.docx")], {
  "1": pending,
});
check("single-file tool waits while the file is checked", !checking.ready);
check("checking state is explained", checking.reason === "Waiting for the first file to finish checking.");

const missingState = getDocxUtilityReadiness("inspect-metadata", [item("1", "a.docx")], {});
check("missing validation state is treated as checking", !missingState.ready);

const invalidFirst = getDocxUtilityReadiness(
  "remove-metadata",
  [item("1", "bad.docx")],
  { "1": invalid("This file is not a valid DOCX package.") }
);
check("invalid first file blocks single-file tools", !invalidFirst.ready);
check(
  "invalid first file reason carries the processor message",
  invalidFirst.reason?.includes("This file is not a valid DOCX package.") === true
);

const readySingle = getDocxUtilityReadiness(
  "extract-text",
  [item("1", "report.docx")],
  { "1": valid }
);
check("valid first file enables single-file tools", readySingle.ready);
check("single-file tool captures the working file name", readySingle.workingFileName === "report.docx");
check("single-file tool captures the working queue id", readySingle.workingItemId === "1");
check("single-file tool targets one file", readySingle.targetCount === 1);
check("ready state has no blocking reason", readySingle.reason === null);

// Confirmation identity: the same display name in a different queue entry is a different file.
const replacedUpload = getDocxUtilityReadiness(
  "remove-metadata",
  [item("2", "report.docx")],
  { "2": valid }
);
check(
  "a same-named replacement keeps the same working file name",
  replacedUpload.workingFileName === "report.docx"
);
check(
  "a same-named replacement has a different queue id",
  replacedUpload.workingItemId === "2"
);
check(
  "confirmation token is stable for the same queue entry",
  getDocxConfirmationToken("remove-metadata", readySingle) ===
    getDocxConfirmationToken("remove-metadata", readySingle)
);
check(
  "confirmation token changes when the entry is replaced",
  getDocxConfirmationToken("remove-metadata", readySingle) !==
    getDocxConfirmationToken("remove-metadata", replacedUpload)
);
check(
  "confirmation token includes the tool",
  getDocxConfirmationToken("remove-metadata", readySingle) !==
    getDocxConfirmationToken("inspect-metadata", readySingle)
);
const blockedSingle = getDocxUtilityReadiness("remove-metadata", [], {});
check(
  "empty queue has no working queue id",
  blockedSingle.workingItemId === null
);
check(
  "confirmation token distinguishes a blocked queue",
  getDocxConfirmationToken("remove-metadata", readySingle) !==
    getDocxConfirmationToken("remove-metadata", blockedSingle)
);

const firstValidSecondInvalid = getDocxUtilityReadiness(
  "extract-text",
  [item("1", "first.docx"), item("2", "second.docx")],
  { "1": valid, "2": invalid("broken") }
);
check(
  "a later invalid file does not block a single-file tool",
  firstValidSecondInvalid.ready && firstValidSecondInvalid.workingFileName === "first.docx"
);

const oneFileMerge = getDocxUtilityReadiness("merge", [item("1", "a.docx")], {
  "1": valid,
});
check("merge needs at least two files", !oneFileMerge.ready);
check(
  "one-file merge reason explains the requirement",
  oneFileMerge.reason === "Add another DOCX file. Merging needs at least two documents."
);

const pendingMerge = getDocxUtilityReadiness(
  "merge",
  [item("1", "a.docx"), item("2", "b.docx")],
  { "1": valid, "2": pending }
);
check("merge waits for every file to be checked", !pendingMerge.ready);

const invalidMerge = getDocxUtilityReadiness(
  "merge",
  [item("1", "a.docx"), item("2", "b.docx")],
  { "1": valid, "2": invalid("This file is not a valid DOCX package.") }
);
check("merge is blocked by any invalid file", !invalidMerge.ready);
check(
  "merge reason names the failing file",
  invalidMerge.reason?.includes("\u201cb.docx\u201d") === true
);

const readyMerge = getDocxUtilityReadiness(
  "merge",
  [item("1", "a.docx"), item("2", "b.docx"), item("3", "c.docx")],
  { "1": valid, "2": valid, "3": valid }
);
check("merge is enabled for two or more valid files", readyMerge.ready);
check("merge targets every queued file", readyMerge.targetCount === 3);

// =========================================================================
// FORMATTING
// =========================================================================

check("bytes below 1 KB stay in bytes", formatBytes(999) === "999 B");
check("1 KB formats as 1 KB", formatBytes(1024) === "1 KB");
check("1.5 KB keeps one decimal", formatBytes(1536) === "1.5 KB");
check("megabytes format with one decimal", formatBytes(1.5 * 1024 * 1024) === "1.5 MB");
check("large megabyte values round", formatBytes(12.4 * 1024 * 1024) === "12 MB");
check("counts use grouped digits", formatCount(1234567) === "1,234,567");
check(
  "document dates are shown in UTC",
  formatMetadataDate("2026-11-15T10:00:00.000Z").includes("Nov 15, 2026") &&
    formatMetadataDate("2026-11-15T10:00:00.000Z").includes("UTC")
);
check(
  "unparseable dates are returned unchanged",
  formatMetadataDate("not-a-date") === "not-a-date"
);

// =========================================================================
// FIELD LABELS
// =========================================================================

const declaredFields = [...DOCX_CORE_FIELDS, ...DOCX_APPLICATION_FIELDS].map(
  (field) => field.field
);
check(
  "inspection groups cover every supported field once",
  declaredFields.length === metadataFields.length &&
    new Set(declaredFields).size === declaredFields.length &&
    metadataFields.every((field) => declaredFields.includes(field))
);
check(
  "every supported field has a display label",
  metadataFields.every((field) => (DOCX_FIELD_LABELS[field] ?? "").length > 0)
);
check(
  "field labels do not repeat",
  new Set(metadataFields.map((field) => DOCX_FIELD_LABELS[field])).size ===
    metadataFields.length
);
check(
  "unknown-to-label lookup returns the field name",
  getDocxFieldLabel("title") === "Title" &&
    getDocxFieldLabel("lastModifiedBy") === "Last modified by"
);

// =========================================================================
// WARNINGS
// =========================================================================

const warnings: DocxWarning[] = [
  { code: "EMPTY_TEXT", message: "This document contains no extractable text." },
  { code: "EMPTY_TEXT", message: "This document contains no extractable text." },
  { code: "EXTRACTION_INCOMPLETE", message: "Some text was not extracted.", detail: "3 of 10" },
  { code: "EXTRACTION_INCOMPLETE", message: "Some text was not extracted.", detail: "4 of 10" },
];
const unique = uniqueDocxWarnings(warnings);
check("duplicate warnings are collapsed", unique.length === 3);
check("warnings with different details are kept apart", unique.filter((warning) => warning.detail).length === 2);
check("warning order is preserved", unique[0] === warnings[0] && unique[1] === warnings[2]);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
