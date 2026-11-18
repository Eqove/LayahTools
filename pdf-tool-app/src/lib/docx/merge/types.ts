/** Public types for the DOCX merge engine. Pure data: no React, no PDF imports. */

import { DOCX_MIME_TYPE } from "../constants";
import type {
  DocxInput,
  DocxLimits,
  DocxProcessingResult,
  DocxWarning,
} from "../types";

/** One ordered merge input. `name`/`mimeType` are only needed for raw bytes or anonymous Blobs. */
export interface DocxMergeSource {
  input: DocxInput;
  name?: string;
  mimeType?: string;
}

export interface DocxMergeOptions {
  limits?: DocxLimits;
  /** Explicit download name. A missing `.docx` suffix is added. Defaults to `merged-<n>-documents.docx`. */
  outputName?: string;
}

/** Per-input facts. Imported counts are attributed to the document that supplied them. */
export interface DocxMergeSourceReport {
  fileName: string;
  paragraphCount: number;
  tableCount: number;
  stylesImported: number;
  numberingImported: number;
  /** Embedded media parts copied for this source. */
  mediaImported: number;
  /** External hyperlink relationships created for this source. */
  hyperlinksImported: number;
  /** Imported bookmark names renamed to avoid a collision with host or earlier content. */
  bookmarksRenumbered: number;
  /** Inline section-break paragraphs created for this source. */
  sectionBreaks: number;
}

/** What was actually checked before the merged package was returned. All true on a clean merge. */
export interface DocxMergeVerification {
  /** The output passed the full DOCX validation pipeline. */
  packageValid: boolean;
  /** The output body has a legal shape: at most one body-level sectPr, and it is last. */
  documentBodyValid: boolean;
  /** Source paragraph/table counts and in-order `<w:t>` text all survived. */
  paragraphOrderPreserved: boolean;
  /** Every non-zero `w:numId` in the body resolves to a `w:num` definition. */
  numberingResolved: boolean;
  /** Every style reference that a source actually defined resolves in the output. */
  styleReferencesResolved: boolean;
  /** Style, numbering and relationship IDs are unique where uniqueness is required. */
  idsUnique: boolean;
  /** Every ZIP entry has a content-type Default or Override, and no Override targets a missing part. */
  contentTypesComplete: boolean;
  /** Every relationship-namespace attribute resolves and every internal target exists. */
  relationshipsResolved: boolean;
  /** Imported media parts exist, are readable and carry image content types. */
  mediaPreserved: boolean;
  /** Imported external hyperlinks exist with their exact targets and `TargetMode="External"`. */
  hyperlinksPreserved: boolean;
  /** Bookmark IDs are unique and start/end pairs match; every internal anchor resolves. */
  bookmarksValid: boolean;
  /** Namespace prefixes and `mc:Ignorable` tokens used by the output are declared and valid. */
  namespacesValid: boolean;
  /** Original inputs still read back exactly as they were supplied. */
  inputsUnchanged: boolean;
  /**
   * Mammoth's extracted text matched every input in order. This is a tolerant check: a false
   * value is reported with MERGE_TEXT_MISMATCH but does not fail an otherwise sound package.
   */
  textPreserved: boolean;
}

export interface DocxMergedDocument {
  /** Host document's original upload name, unchanged. */
  fileName: string;
  outputFileName: string;
  mimeType: typeof DOCX_MIME_TYPE;
  bytes: Uint8Array;
  /** Browser-ready Blob tagged with the DOCX MIME type. */
  blob: Blob;
  byteLength: number;
  sourceCount: number;
  sources: DocxMergeSourceReport[];
  merged: {
    paragraphs: number;
    tables: number;
    styles: number;
    /** `w:num` + `w:abstractNum` elements in the merged numbering part. */
    numberingDefinitions: number;
    /** Inline section-break paragraphs created across the merge. */
    sectionBreaks: number;
    /** Embedded media parts imported from later documents. */
    media: number;
    /** External hyperlink relationships imported from later documents. */
    hyperlinks: number;
    /** Bookmarks imported from later documents. */
    bookmarks: number;
  };
  verification: DocxMergeVerification;
  warnings: DocxWarning[];
}

export type DocxMergeResult = DocxProcessingResult<DocxMergedDocument>;
