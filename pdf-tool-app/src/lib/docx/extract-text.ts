/**
 * DOCX text extraction.
 *
 * Uses Mammoth's prebuilt browser bundle (`mammoth/mammoth.browser.js`) and its
 * `{ arrayBuffer }` input, which is the only shape that bundle accepts. The Node build's
 * `{ buffer }` input is never used: this module is browser-only by design.
 *
 * Nothing here renders HTML, touches the network, or modifies the uploaded file. Mammoth is
 * loaded dynamically so it stays out of the initial workspace bundle.
 */

import { WORD_NAMESPACE } from "./constants";
import { DocxErrors, toDocxError } from "./errors";
import type { DocxInput, DocxProcessingResult, DocxWarning } from "./types";
import {
  describeDocxInput,
  readDocxBytes,
  validateDocxFile,
  type DocxValidateOptions,
} from "./validate";

export interface DocxTextExtraction {
  /** Readable text, paragraphs separated by a blank line. */
  text: string;
  /** Name of the uploaded file, unchanged. */
  fileName: string;
  /** `text.length`, in UTF-16 code units. */
  characterCount: number;
  /** Whitespace-delimited words. Approximate: CJK text counts as one per run. */
  wordCount: number;
  warnings: DocxWarning[];
}

/** Below this share of the document's text, extraction is reported as incomplete. */
const MIN_TEXT_COVERAGE = 0.8;

/**
 * Loads Mammoth's browser bundle.
 * The package ships no type declarations and no export map, hence the local module
 * declaration in `mammoth-browser.d.ts`.
 */
const loadMammoth = async () => (await import("mammoth/mammoth.browser.js")).default;

/**
 * Normalises Mammoth's raw text.
 *
 * `extractRawText` already separates paragraphs with a blank line; this only removes
 * trailing spaces, normalises line endings, and collapses runs of blank lines.
 */
export function normalizeDocxText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const nonWhitespaceLength = (value: string): number => value.replace(/\s+/g, "").length;

/** Characters of real text present in `word/document.xml`, from its `<w:t>` runs. */
const documentTextLength = (document: Document): number => {
  const nodes = document.getElementsByTagNameNS(WORD_NAMESPACE, "t");
  let length = 0;
  for (let index = 0; index < nodes.length; index++) {
    length += nonWhitespaceLength(nodes[index].textContent ?? "");
  }
  return length;
};

const mapMammothWarnings = (messages: unknown): DocxWarning[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message): message is { message?: unknown; type?: unknown } => Boolean(message))
    .map((message) => ({
      code: "EXTRACTION_WARNING" as const,
      message: typeof message.message === "string" ? message.message : "Mammoth reported a problem.",
      detail: typeof message.type === "string" ? message.type : undefined,
    }));
};

/**
 * Extracts readable text from a DOCX.
 *
 * The file is validated first, so structural problems are reported with the foundation's
 * typed errors rather than surfacing as Mammoth failures. Extraction then runs in memory and
 * the result is checked against the document's own text so an empty or truncated result is
 * never returned silently.
 */
export async function extractDocxText(
  input: DocxInput,
  options: DocxValidateOptions = {}
): Promise<DocxProcessingResult<DocxTextExtraction>> {
  const warnings: DocxWarning[] = [];

  let info: ReturnType<typeof describeDocxInput>;
  let bytes: Uint8Array;
  try {
    info = describeDocxInput(input, options);
    bytes = await readDocxBytes(input);
  } catch (error) {
    return { ok: false, error: toDocxError(error), warnings };
  }

  const validation = await validateDocxFile(bytes, {
    name: info.name,
    mimeType: info.mimeType,
    limits: options.limits,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error, warnings: validation.warnings };
  }
  warnings.push(...validation.warnings);

  // `readDocxBytes` always returns an exact-size copy, so its buffer is a complete ArrayBuffer.
  const arrayBuffer = bytes.buffer as ArrayBuffer;

  let rawText: string;
  let mammothWarnings: DocxWarning[];
  try {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer });
    rawText = typeof result.value === "string" ? result.value : "";
    mammothWarnings = mapMammothWarnings(result.messages);
  } catch (error) {
    return {
      ok: false,
      error: DocxErrors.processingFailure(
        "The text could not be extracted from this document.",
        toDocxError(error).detail ?? toDocxError(error).message
      ),
      warnings,
    };
  }
  warnings.push(...mammothWarnings);

  const text = normalizeDocxText(rawText);
  const extractedLength = nonWhitespaceLength(text);
  const documentLength = documentTextLength(validation.value.document);

  if (extractedLength === 0 && documentLength > 0) {
    return {
      ok: false,
      error: DocxErrors.processingFailure(
        "Text extraction returned no content for a document that contains text.",
        `${documentLength} characters in ${info.name}`
      ),
      warnings,
    };
  }

  if (extractedLength === 0) {
    warnings.push({ code: "EMPTY_TEXT", message: "This document contains no extractable text." });
  } else if (documentLength > 0 && extractedLength / documentLength < MIN_TEXT_COVERAGE) {
    warnings.push({
      code: "EXTRACTION_INCOMPLETE",
      message: "Some text in this document could not be extracted.",
      detail: `${extractedLength} of ${documentLength} characters`,
    });
  }

  return {
    ok: true,
    value: {
      text,
      fileName: info.name,
      characterCount: text.length,
      wordCount: text.length > 0 ? text.split(/\s+/).filter(Boolean).length : 0,
      warnings,
    },
    warnings,
  };
}
