/**
 * DOCX file-queue operations and file inspection.
 *
 * The queue mirrors the PDF workspace behaviour (append, remove, reorder, never reorder on add)
 * but accepts only DOCX inputs. Adding is synchronous and cheap: it screens name, MIME type,
 * emptiness and size. Full package validation is the separate async `validateDocxQueue`.
 *
 * Files are stored by reference and never modified. No bytes are written anywhere.
 */

import { DEFAULT_DOCX_LIMITS } from "./constants";
import { readMetadataFromPackage } from "./metadata";
import type {
  AddDocxFilesResult,
  DocxInspection,
  DocxInput,
  DocxLimits,
  DocxProcessingResult,
  DocxQueueItem,
  DocxQueueValidation,
  DocxRejectedFile,
} from "./types";
import { isDocxFileName, isDocxMimeType, validateDocxFile, type DocxValidateOptions } from "./validate";

/** Identity of an upload for duplicate detection: name, size and modified time. */
export const sameDocxFile = (a: File, b: File): boolean =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Cheap, synchronous screening applied before a file enters the queue.
 * Returns the rejection reason, or null when the file is plausible.
 *
 * The ZIP signature is deliberately not checked here: that needs the bytes. A file that passes
 * screening can still fail `validateDocxQueue`, which is the authoritative check.
 */
export function screenDocxFile(
  file: File,
  limits: DocxLimits = DEFAULT_DOCX_LIMITS
): DocxRejectedFile | null {
  const reject = (code: DocxRejectedFile["code"], message: string): DocxRejectedFile => ({
    name: file.name,
    code,
    message,
  });

  if (!isDocxFileName(file.name)) {
    return reject("UNSUPPORTED_FORMAT", "Only .docx files are supported.");
  }
  if (!isDocxMimeType(file.type || "")) {
    return reject("UNSUPPORTED_FORMAT", "This file type is not supported.");
  }
  if (file.size === 0) {
    return reject("EMPTY_DOCUMENT", "The file is empty.");
  }
  if (file.size > limits.maxFileBytes) {
    return reject(
      "INVALID_FILE",
      `This file is larger than the ${Math.round(limits.maxFileBytes / (1024 * 1024))} MB limit.`
    );
  }
  return null;
}

/**
 * Appends picked files to the queue.
 *
 * Existing entries are kept in place and never reordered. An identical re-selection is skipped
 * and counted as a duplicate; the same name with different content is kept as a new entry.
 * Invalid files are returned in `rejected` instead of being silently dropped.
 */
export function addDocxFiles(
  items: DocxQueueItem[],
  picked: File[],
  newId: () => string,
  limits: DocxLimits = DEFAULT_DOCX_LIMITS
): AddDocxFilesResult {
  const accepted: File[] = [];
  const rejected: DocxRejectedFile[] = [];

  for (const file of picked) {
    const rejection = screenDocxFile(file, limits);
    if (rejection) rejected.push(rejection);
    else accepted.push(file);
  }

  const fresh = accepted.filter(
    (file, index) =>
      !items.some((entry) => sameDocxFile(entry.file, file)) &&
      accepted.findIndex((other) => sameDocxFile(other, file)) === index
  );

  const added = fresh.map((file) => ({ id: newId(), file }));
  return {
    items: [...items, ...added],
    added,
    rejected,
    duplicates: accepted.length - fresh.length,
  };
}

export const removeDocxFile = (items: DocxQueueItem[], id: string): DocxQueueItem[] =>
  items.filter((item) => item.id !== id);

/**
 * Moves one queue entry, returning a new array.
 *
 * Index form: `(items, fromIndex, toIndex)`.
 * Id form: `(items, fromId, targetId)` inserts before the target, `(items, fromId, null)` moves
 * to the end. Unknown ids and out-of-range indexes leave the order untouched.
 */
export function reorderDocxFiles(
  items: DocxQueueItem[],
  from: string | number,
  to: string | number | null
): DocxQueueItem[] {
  if (items.length <= 1) return [...items];

  if (typeof from === "number" && typeof to === "number") {
    if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
      return [...items];
    }
    const result = [...items];
    const [moved] = result.splice(from, 1);
    result.splice(to, 0, moved);
    return result;
  }

  const fromId = String(from);
  const fromIndex = items.findIndex((item) => item.id === fromId);
  if (fromIndex === -1) return [...items];

  const moved = items[fromIndex];
  const without = items.filter((item) => item.id !== fromId);

  if (to === null) return [...without, moved];

  const toId = String(to);
  if (fromId === toId) return [...items];

  const toIndex = without.findIndex((item) => item.id === toId);
  if (toIndex === -1) return [...without, moved];

  const result = [...without];
  result.splice(toIndex, 0, moved);
  return result;
}

/** Validates every queue entry. Runs sequentially so N large files are not decompressed at once. */
export async function validateDocxQueue(
  items: DocxQueueItem[],
  limits: DocxLimits = DEFAULT_DOCX_LIMITS
): Promise<DocxQueueValidation> {
  const entries: DocxQueueValidation["entries"] = [];
  for (const item of items) {
    entries.push({
      id: item.id,
      name: item.file.name,
      result: await validateDocxFile(item.file, { limits }),
    });
  }
  return { ok: entries.every((entry) => entry.result.ok), entries };
}

/**
 * Validates a file and reads its metadata.
 * Warnings from both stages are merged; failures carry the validation error unchanged.
 */
export async function inspectDocxFile(
  input: DocxInput,
  options: DocxValidateOptions = {}
): Promise<DocxProcessingResult<DocxInspection>> {
  const limits = options.limits ?? DEFAULT_DOCX_LIMITS;
  const validated = await validateDocxFile(input, { ...options, limits });
  if (!validated.ok) return validated;

  const { metadata, warnings } = await readMetadataFromPackage(validated.value.package, limits);
  const merged = [...validated.warnings, ...warnings];

  return {
    ok: true,
    value: {
      info: validated.value.info,
      package: validated.value.package,
      metadata,
      warnings: merged,
    },
    warnings: merged,
  };
}
