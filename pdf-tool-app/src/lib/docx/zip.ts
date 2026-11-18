/**
 * Safe DOCX package loading built on JSZip.
 *
 * Everything stays in memory: this module never touches the filesystem, never writes to disk,
 * and never mutates the bytes it is given. Limits are enforced twice — once from the ZIP
 * directory before anything is decompressed, and again on the real byte length of each part
 * that is read, because directory sizes are attacker-controlled.
 */

import JSZip from "jszip";
import {
  CONTENT_TYPES_PATH,
  DEFAULT_DOCX_LIMITS,
  DOCUMENT_PATH,
  DOCX_MIME_TYPE,
} from "./constants";
import { DocxErrors, toDocxError } from "./errors";
import type { DocxLimits, DocxPackage, DocxWarning } from "./types";

/** JSZip keeps declared sizes on the private `_data` record; there is no public accessor. */
interface ZipEntryData {
  uncompressedSize?: number;
  compressedSize?: number;
}

const declaredSize = (entry: JSZip.JSZipObject): number => {
  const data = (entry as unknown as { _data?: ZipEntryData })._data;
  return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : 0;
};

const declaredCompressedSize = (entry: JSZip.JSZipObject): number => {
  const data = (entry as unknown as { _data?: ZipEntryData })._data;
  return typeof data?.compressedSize === "number" ? data.compressedSize : 0;
};

/** Number of real (non-directory) entries. Word writes directory records for some folders. */
function listEntries(zip: JSZip): JSZip.JSZipObject[] {
  return Object.values(zip.files).filter((entry) => !entry.dir);
}

/**
 * Opens a DOCX ZIP package and enforces entry-count and size limits.
 *
 * `checkCRC32` is off deliberately: verifying CRCs would decompress every entry up front,
 * which defeats the point of a size limit. Integrity is checked on the parts that are read.
 */
export async function openDocxPackage(
  bytes: Uint8Array,
  limits: DocxLimits = DEFAULT_DOCX_LIMITS
): Promise<DocxPackage> {
  if (bytes.length === 0) {
    throw DocxErrors.emptyDocument("The document is empty.");
  }

  let zip: JSZip;
  try {
    // Copy so JSZip can never hold a view onto the caller's buffer.
    zip = await JSZip.loadAsync(bytes.slice(), { checkCRC32: false, createFolders: false });
  } catch (error) {
    throw DocxErrors.corruptedPackage(
      "The document is not a readable DOCX package.",
      toDocxError(error).detail ?? "ZIP directory could not be read"
    );
  }

  const entries = listEntries(zip);
  if (entries.length === 0) {
    throw DocxErrors.unsupportedStructure("The DOCX package contains no files.");
  }
  if (entries.length > limits.maxEntries) {
    throw DocxErrors.unsupportedStructure(
      `The document has too many package entries (${entries.length}).`,
      `limit: ${limits.maxEntries}`
    );
  }

  let uncompressedSize = 0;
  let compressedSize = 0;
  for (const entry of entries) {
    const size = declaredSize(entry);
    if (size > limits.maxEntryBytes) {
      throw DocxErrors.unsupportedStructure(
        "The document contains a package entry that is too large.",
        `${entry.name}: ${size} bytes, limit ${limits.maxEntryBytes}`
      );
    }
    uncompressedSize += size;
    compressedSize += declaredCompressedSize(entry);
  }

  if (uncompressedSize > limits.maxUncompressedBytes) {
    throw DocxErrors.unsupportedStructure(
      "The document expands to more content than this workspace supports.",
      `${uncompressedSize} bytes, limit ${limits.maxUncompressedBytes}`
    );
  }

  const warnings: DocxWarning[] = [];
  if (
    uncompressedSize > 1024 * 1024 &&
    compressedSize > 0 &&
    uncompressedSize / compressedSize > limits.maxCompressionRatio
  ) {
    warnings.push({
      code: "HIGH_COMPRESSION_RATIO",
      message: "This document expands a great deal from its compressed size.",
      detail: `${Math.round(uncompressedSize / compressedSize)}:1`,
    });
  }

  const entryNames = entries.map((entry) => entry.name).sort();

  return {
    zip,
    info: {
      entryCount: entries.length,
      entryNames,
      uncompressedSize,
      compressedSize,
      hasContentTypes: Boolean(zip.file(CONTENT_TYPES_PATH)),
      hasDocumentXml: Boolean(zip.file(DOCUMENT_PATH)),
    },
    warnings,
  };
}

/**
 * Reads one package part with the real-size limit applied.
 * Throws `UNSUPPORTED_STRUCTURE` for an oversized part and `CORRUPTED_PACKAGE` for bad data.
 */
export async function readDocxEntry(
  pkg: DocxPackage,
  path: string,
  limits: DocxLimits = DEFAULT_DOCX_LIMITS
): Promise<Uint8Array> {
  const entry = pkg.zip.file(path);
  if (!entry) {
    throw DocxErrors.unsupportedStructure(`The document is missing ${path}.`);
  }

  let bytes: Uint8Array;
  try {
    bytes = await entry.async("uint8array");
  } catch (error) {
    throw DocxErrors.corruptedPackage(
      `The document part ${path} could not be read.`,
      toDocxError(error).detail
    );
  }

  if (bytes.length > limits.maxEntryBytes) {
    throw DocxErrors.unsupportedStructure(
      `The document part ${path} is too large.`,
      `${bytes.length} bytes, limit ${limits.maxEntryBytes}`
    );
  }
  return bytes;
}

/** Reads a part as UTF-8 text. Invalid UTF-8 is reported as a corrupted package, not mojibake. */
export async function readDocxEntryText(
  pkg: DocxPackage,
  path: string,
  limits: DocxLimits = DEFAULT_DOCX_LIMITS
): Promise<string> {
  const bytes = await readDocxEntry(pkg, path, limits);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw DocxErrors.corruptedPackage(
      `The document part ${path} is not valid UTF-8.`,
      toDocxError(error).detail
    );
  }
}

export interface SaveDocxPackageOptions {
  limits?: DocxLimits;
  /** DEFLATE by default; STORE is useful for tests that need byte-level stability. */
  compression?: "DEFLATE" | "STORE";
  compressionLevel?: number;
}

export interface SavedDocxPackage {
  bytes: Uint8Array;
  /** Browser-ready download Blob tagged with the DOCX MIME type. */
  blob: Blob;
  mimeType: typeof DOCX_MIME_TYPE;
  byteLength: number;
}

/**
 * Serialises an opened DOCX package into a fresh download artefact.
 *
 * This is the single ZIP-write path: callers mutate their in-memory package parts first, then
 * hand the package here. The caller's original upload bytes are never involved. The generated
 * file is re-checked against the upload size limit so a merge cannot quietly produce a download
 * larger than the workspace is willing to handle.
 */
export async function saveDocxPackage(
  pkg: DocxPackage,
  options: SaveDocxPackageOptions = {}
): Promise<SavedDocxPackage> {
  const limits = options.limits ?? DEFAULT_DOCX_LIMITS;

  let bytes: Uint8Array;
  try {
    bytes = await pkg.zip.generateAsync({
      type: "uint8array",
      compression: options.compression ?? "DEFLATE",
      compressionOptions: { level: options.compressionLevel ?? 6 },
    });
  } catch (error) {
    throw DocxErrors.processingFailure(
      "The document could not be saved.",
      toDocxError(error).detail ?? toDocxError(error).message
    );
  }

  if (bytes.length === 0) {
    throw DocxErrors.processingFailure("The saved document was empty.");
  }
  if (bytes.length > limits.maxFileBytes) {
    throw DocxErrors.unsupportedStructure(
      `The saved document is larger than the ${Math.round(limits.maxFileBytes / (1024 * 1024))} MB limit.`,
      `${bytes.length} bytes, limit ${limits.maxFileBytes}`
    );
  }

  return {
    bytes,
    blob: new Blob([bytes as BlobPart], { type: DOCX_MIME_TYPE }),
    mimeType: DOCX_MIME_TYPE,
    byteLength: bytes.length,
  };
}
