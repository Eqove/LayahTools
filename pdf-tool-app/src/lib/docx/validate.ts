/**
 * Browser-compatible DOCX validation.
 *
 * The checks run cheapest-first so a bad file is rejected before any decompression:
 * name/MIME, size, empty input, OLE container (encrypted), ZIP signature, package limits,
 * required parts, and finally well-formed main document XML.
 *
 * Validation never mutates the input: `readDocxBytes` always returns a copy.
 */

import {
  CONTENT_TYPES_PATH,
  DOCUMENT_PATH,
  DOCX_ACCEPTED_MIME_TYPES,
  DOCX_EXTENSION,
  DOCX_MIME_TYPES,
  DOCX_UNKNOWN_MIME_TYPES,
  OLE_CONTAINER_SIGNATURE,
  RECOMMENDED_DOCX_ENTRIES,
  WORD_NAMESPACE,
  ZIP_SIGNATURE,
  DEFAULT_DOCX_LIMITS,
} from "./constants";
import { DocxErrors, toDocxError } from "./errors";
import type {
  DocxFileInfo,
  DocxInput,
  DocxLimits,
  DocxValidationResult,
  DocxWarning,
} from "./types";
import { findElement, parseXml } from "./xml";
import { openDocxPackage, readDocxEntryText } from "./zip";

export interface DocxValidateOptions {
  /** Used when the input has no name of its own (raw bytes, anonymous Blob). */
  name?: string;
  /** Used when the input has no MIME type of its own. */
  mimeType?: string;
  limits?: DocxLimits;
}

const DEFAULT_FILE_NAME = "document.docx";

export const isDocxFileName = (name: string): boolean =>
  name.trim().toLowerCase().endsWith(DOCX_EXTENSION);

/** Recognised as a WordprocessingML MIME type, whether or not this workspace supports it. */
export const isWordMimeType = (mimeType: string): boolean =>
  (DOCX_MIME_TYPES as readonly string[]).includes(mimeType);

/**
 * True when the MIME type is usable. Browsers often report `""` or
 * `application/octet-stream` for DOCX, so those are accepted and the ZIP signature decides.
 * A confidently wrong type (PDF, plain text, macro-enabled DOCX) is rejected.
 */
export const isDocxMimeType = (mimeType: string): boolean =>
  mimeType === "" ||
  (DOCX_UNKNOWN_MIME_TYPES as readonly string[]).includes(mimeType) ||
  (DOCX_ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType);

export const hasZipSignature = (bytes: Uint8Array): boolean =>
  ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);

export const isOleContainer = (bytes: Uint8Array): boolean =>
  OLE_CONTAINER_SIGNATURE.every((byte, index) => bytes[index] === byte);

/** Reads any supported input into a fresh byte array. The source is never mutated. */
export async function readDocxBytes(input: DocxInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw DocxErrors.invalidFile("The file could not be read.");
}

/**
 * Derives the file facts used for validation and reporting.
 * Throws `INVALID_FILE` for inputs that are not files or bytes at all.
 */
export function describeDocxInput(input: DocxInput, options: DocxValidateOptions = {}): DocxFileInfo {
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const isFile = typeof File !== "undefined" && input instanceof File;
    return {
      name: (isFile ? (input as File).name : "") || options.name || DEFAULT_FILE_NAME,
      size: input.size,
      mimeType: input.type || options.mimeType || "",
      lastModified: isFile ? (input as File).lastModified : 0,
    };
  }

  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    return {
      name: options.name || DEFAULT_FILE_NAME,
      size: input.byteLength,
      mimeType: options.mimeType || "",
      lastModified: 0,
    };
  }

  throw DocxErrors.invalidFile("No DOCX file was provided.");
}

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Validates a DOCX end to end and returns the parsed main document on success.
 * Failures are typed `DocxError`s; the function never throws.
 */
export async function validateDocxFile(
  input: DocxInput,
  options: DocxValidateOptions = {}
): Promise<DocxValidationResult> {
  const limits = options.limits ?? DEFAULT_DOCX_LIMITS;
  const warnings: DocxWarning[] = [];

  try {
    const info = describeDocxInput(input, options);

    if (!isDocxFileName(info.name)) {
      throw DocxErrors.unsupportedFormat(
        "Only .docx files are supported.",
        `received: ${info.name || "(no name)"}`
      );
    }
    if (!isDocxMimeType(info.mimeType)) {
      throw DocxErrors.unsupportedFormat(
        "This file type is not supported. Choose a Word .docx document.",
        `received: ${info.mimeType}`
      );
    }
    if (info.size === 0) {
      throw DocxErrors.emptyDocument("The file is empty.");
    }
    if (info.size > limits.maxFileBytes) {
      throw DocxErrors.invalidFile(
        `This file is larger than the ${formatBytes(limits.maxFileBytes)} limit.`,
        `${info.size} bytes`
      );
    }

    const bytes = await readDocxBytes(input);

    if (isOleContainer(bytes)) {
      throw DocxErrors.encryptedDocument(
        "This document is password-protected. Remove the password in Word and try again."
      );
    }
    if (!hasZipSignature(bytes)) {
      throw DocxErrors.corruptedPackage(
        "This file is not a valid DOCX package.",
        "missing ZIP signature"
      );
    }

    const pkg = await openDocxPackage(bytes, limits);
    warnings.push(...pkg.warnings);

    if (!pkg.info.hasContentTypes) {
      throw DocxErrors.unsupportedStructure(
        "The document is missing its content-types manifest.",
        CONTENT_TYPES_PATH
      );
    }
    if (!pkg.info.hasDocumentXml) {
      throw DocxErrors.unsupportedStructure("The document has no main document part.", DOCUMENT_PATH);
    }

    for (const path of RECOMMENDED_DOCX_ENTRIES) {
      if (!pkg.info.entryNames.includes(path)) {
        warnings.push({
          code: "MISSING_METADATA",
          message: "This document has no document properties.",
          detail: path,
        });
      }
    }

    const documentXml = await readDocxEntryText(pkg, DOCUMENT_PATH, limits);
    if (documentXml.trim().length === 0) {
      throw DocxErrors.emptyDocument("This document contains no content.");
    }

    const parsed = parseXml(documentXml, DOCUMENT_PATH);
    warnings.push(...parsed.warnings);

    const root = parsed.document.documentElement;
    if (root.localName !== "document" || root.namespaceURI !== WORD_NAMESPACE) {
      throw DocxErrors.unsupportedStructure(
        "The main document part is not a WordprocessingML document.",
        `root: ${root.nodeName} (${root.namespaceURI ?? "no namespace"})`
      );
    }

    const body = findElement(parsed.document, WORD_NAMESPACE, "body");
    if (!body) {
      throw DocxErrors.unsupportedStructure("The document has no body.");
    }
    if (!body.hasChildNodes()) {
      warnings.push({ code: "EMPTY_BODY", message: "The document body is empty." });
    }

    const value = {
      info,
      package: pkg,
      document: parsed.document,
    };
    return { ok: true, value, warnings };
  } catch (error) {
    return { ok: false, error: toDocxError(error), warnings };
  }
}
