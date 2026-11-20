/** Shared DOCX types. Pure data only: no React, no PDF imports. */

import type JSZip from "jszip";
import type { DocxError, DocxErrorCode } from "./errors";

/** File-level facts about a DOCX input, independent of the package contents. */
export interface DocxFileInfo {
  name: string;
  size: number;
  /** Empty when the browser or caller did not supply a MIME type. */
  mimeType: string;
  lastModified: number;
}

/** Values read from `docProps/core.xml` and `docProps/app.xml`. All fields are optional. */
export interface DocxMetadata {
  title?: string;
  subject?: string;
  creator?: string;
  description?: string;
  keywords?: string;
  lastModifiedBy?: string;
  revision?: string;
  category?: string;
  /** ISO 8601 UTC string, normalised from the stored W3CDTF value. */
  created?: string;
  /** ISO 8601 UTC string, normalised from the stored W3CDTF value. */
  modified?: string;
  application?: string;
  applicationVersion?: string;
  company?: string;
  manager?: string;
  /** Advisory: whatever Word last recorded. Not a live count of the current document. */
  pages?: number;
  /** Advisory: whatever Word last recorded. Not a live count of the current document. */
  words?: number;
  /** Advisory: whatever Word last recorded. Not a live count of the current document. */
  characters?: number;
}

/** Structural facts about the ZIP container, before any document parsing. */
export interface DocxPackageInfo {
  entryCount: number;
  entryNames: string[];
  /** Sum of the sizes declared in the ZIP directory, not the decompressed total. */
  uncompressedSize: number;
  compressedSize: number;
  hasContentTypes: boolean;
  hasDocumentXml: boolean;
}

/** Limits applied to an uploaded package. Every check is opt-out by overriding these. */
export interface DocxLimits {
  /** Maximum size of the uploaded file in bytes. */
  maxFileBytes: number;
  /** Maximum number of non-directory ZIP entries. */
  maxEntries: number;
  /** Maximum total declared uncompressed size across all entries. */
  maxUncompressedBytes: number;
  /** Maximum declared size of a single entry. */
  maxEntryBytes: number;
  /** Declared-to-compressed ratio that triggers a warning above 1 MiB. */
  maxCompressionRatio: number;
}

export type DocxWarningCode =
  | "EMPTY_BODY"
  | "EMPTY_TEXT"
  | "EXTRACTION_INCOMPLETE"
  | "EXTRACTION_WARNING"
  | "INVALID_METADATA_VALUE"
  | "MALFORMED_METADATA"
  /** Cleanup succeeded, but parts outside supported coverage (e.g. custom properties) remain. */
  | "METADATA_RETAINED"
  | "MISSING_METADATA"
  | "XML_WARNING"
  | "HIGH_COMPRESSION_RATIO"
  /** The same style ID exists in two documents with different definitions; the first wins. */
  | "MERGE_STYLE_CONFLICT"
  /** A selected document contains content the merge cannot preserve, so nothing was merged. */
  | "MERGE_CONTENT_UNSUPPORTED"
  /** Extracted text did not match exactly; the package itself still passed structural checks. */
  | "MERGE_TEXT_MISMATCH";

/** A non-fatal finding. Warnings never make a package invalid on their own. */
export interface DocxWarning {
  code: DocxWarningCode;
  message: string;
  detail?: string;
}

/** Result of an operation that can either produce a value or a typed failure. */
export type DocxProcessingResult<T> =
  | { ok: true; value: T; warnings: DocxWarning[] }
  | { ok: false; error: DocxError; warnings: DocxWarning[] };

/** A package that passed validation, with the parsed main document part. */
export interface DocxValidatedPackage {
  info: DocxFileInfo;
  package: DocxPackage;
  document: Document;
}

export type DocxValidationResult = DocxProcessingResult<DocxValidatedPackage>;

/** Validation plus metadata, used when a caller needs to describe a file before processing it. */
export interface DocxInspection {
  info: DocxFileInfo;
  package: DocxPackage;
  metadata: DocxMetadata;
  warnings: DocxWarning[];
}

/** An opened ZIP package. `info` summarises it; `zip` is handed to JSZip read helpers. */
export interface DocxPackage {
  zip: JSZip;
  info: DocxPackageInfo;
  warnings: DocxWarning[];
}

/**
 * Anything a browser can hand us: a picked `File`, a drag-and-drop `Blob`, raw bytes,
 * or an `ArrayBuffer`. Inputs are never mutated; bytes are always copied.
 */
export type DocxInput = File | Blob | ArrayBuffer | Uint8Array;

export interface DocxQueueItem {
  id: string;
  file: File;
}

/** A file that was refused before entering the queue, with the reason. */
export interface DocxRejectedFile {
  name: string;
  code: DocxErrorCode;
  message: string;
}

export interface AddDocxFilesResult {
  items: DocxQueueItem[];
  added: DocxQueueItem[];
  rejected: DocxRejectedFile[];
  /** Files skipped because an identical entry (name, size, modified time) already exists. */
  duplicates: number;
}

export interface DocxQueueValidationEntry {
  id: string;
  name: string;
  result: DocxValidationResult;
}

export interface DocxQueueValidation {
  ok: boolean;
  entries: DocxQueueValidationEntry[];
}
