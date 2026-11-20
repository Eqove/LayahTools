/**
 * DOCX to plain-text conversion.
 *
 * This module owns only the TXT package: output filename, MIME type and UTF-8 bytes.
 * All reading, validation and text extraction is delegated to `extractDocxText`, so there is
 * exactly one DOCX extraction engine and its warnings flow through unchanged.
 *
 * Pure processing: no React, no PDF code, no DOM. The produced `blob` is what a UI would hand
 * to `URL.createObjectURL`, but the download gesture itself belongs to the UI layer.
 */

import { extractDocxText } from "./extract-text";
import type { DocxInput, DocxProcessingResult, DocxWarning } from "./types";
import type { DocxValidateOptions } from "./validate";

/** Explicit charset so browsers and editors never guess the encoding. */
export const TXT_MIME_TYPE = "text/plain;charset=utf-8";

export const DOCX_TO_TXT_FALLBACK_NAME = "document.txt";

export interface DocxTxtConversion {
  /** Extracted text, unchanged from `extractDocxText`. */
  text: string;
  /** Original upload name. */
  fileName: string;
  /** Suggested download name: `example.docx` becomes `example.txt`. */
  outputFileName: string;
  mimeType: typeof TXT_MIME_TYPE;
  /** UTF-8 bytes of `text`, without a byte-order mark. */
  bytes: Uint8Array;
  /** Browser-ready Blob with the correct MIME type. */
  blob: Blob;
  /** `text.length`, in UTF-16 code units. */
  characterCount: number;
  /** Length of the UTF-8 encoding; larger than `characterCount` for non-ASCII text. */
  byteLength: number;
  wordCount: number;
  warnings: DocxWarning[];
}

/**
 * Derives the download name.
 *
 * Only a trailing `.docx` is replaced, so `archive.tar.docx` becomes `archive.tar.txt` and the
 * rest of the name is preserved verbatim. Names without an extension get `.txt` appended.
 */
export function toTxtFileName(fileName: string): string {
  const name = fileName.trim();
  if (!name) return DOCX_TO_TXT_FALLBACK_NAME;

  const base = name.slice(0, name.length - ".docx".length);
  if (/\.docx$/i.test(name) && base.trim().length > 0) {
    return `${base}.txt`;
  }
  if (/\.docx$/i.test(name)) return DOCX_TO_TXT_FALLBACK_NAME;
  return `${name}.txt`;
}

/**
 * Converts a DOCX into downloadable plain text.
 *
 * Validation and extraction failures are returned unchanged. Empty documents convert into an
 * empty TXT file: the extraction warning explains why it is empty.
 */
export async function convertDocxToTxt(
  input: DocxInput,
  options: DocxValidateOptions = {}
): Promise<DocxProcessingResult<DocxTxtConversion>> {
  const extraction = await extractDocxText(input, options);
  if (!extraction.ok) {
    return { ok: false, error: extraction.error, warnings: extraction.warnings };
  }

  const { text, fileName, characterCount, wordCount, warnings } = extraction.value;
  const bytes = new TextEncoder().encode(text);
  const blob = new Blob([bytes as BlobPart], { type: TXT_MIME_TYPE });

  return {
    ok: true,
    value: {
      text,
      fileName,
      outputFileName: toTxtFileName(fileName),
      mimeType: TXT_MIME_TYPE,
      bytes,
      blob,
      characterCount,
      byteLength: bytes.length,
      wordCount,
      warnings,
    },
    warnings,
  };
}
