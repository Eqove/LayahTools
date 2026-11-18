/**
 * Standardised DOCX errors.
 *
 * Codes are a closed union so callers can switch exhaustively instead of matching
 * message text. Messages are user-facing; `detail` carries the technical cause and
 * is never shown raw in the UI.
 */

export const DOCX_ERROR_CODES = [
  "INVALID_FILE",
  "UNSUPPORTED_FORMAT",
  "CORRUPTED_PACKAGE",
  "EMPTY_DOCUMENT",
  "ENCRYPTED_DOCUMENT",
  "UNSUPPORTED_STRUCTURE",
  "PROCESSING_FAILURE",
] as const;

export type DocxErrorCode = (typeof DOCX_ERROR_CODES)[number];

export class DocxError extends Error {
  readonly code: DocxErrorCode;
  readonly detail?: string;

  constructor(code: DocxErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "DocxError";
    this.code = code;
    this.detail = detail;
  }
}

export const isDocxError = (value: unknown): value is DocxError =>
  value instanceof DocxError ||
  (typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "DocxError" &&
    typeof (value as { code?: unknown }).code === "string" &&
    (DOCX_ERROR_CODES as readonly string[]).includes((value as { code: string }).code));

/** Normalises anything thrown into a typed DOCX error without losing the cause. */
export function toDocxError(
  value: unknown,
  fallbackCode: DocxErrorCode = "PROCESSING_FAILURE",
  fallbackMessage = "The document could not be processed."
): DocxError {
  if (isDocxError(value)) return value;
  const detail =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : undefined;
  return new DocxError(fallbackCode, fallbackMessage, detail);
}

/** One-line description for logs and test assertions. */
export function describeDocxError(error: unknown): string {
  const typed = toDocxError(error);
  return typed.detail ? `${typed.code}: ${typed.message} (${typed.detail})` : `${typed.code}: ${typed.message}`;
}

/** Factories that keep messages consistent across modules. */
export const DocxErrors = {
  invalidFile: (message: string, detail?: string) => new DocxError("INVALID_FILE", message, detail),
  unsupportedFormat: (message: string, detail?: string) =>
    new DocxError("UNSUPPORTED_FORMAT", message, detail),
  corruptedPackage: (message: string, detail?: string) =>
    new DocxError("CORRUPTED_PACKAGE", message, detail),
  emptyDocument: (message: string, detail?: string) => new DocxError("EMPTY_DOCUMENT", message, detail),
  encryptedDocument: (message: string, detail?: string) =>
    new DocxError("ENCRYPTED_DOCUMENT", message, detail),
  unsupportedStructure: (message: string, detail?: string) =>
    new DocxError("UNSUPPORTED_STRUCTURE", message, detail),
  processingFailure: (message: string, detail?: string) =>
    new DocxError("PROCESSING_FAILURE", message, detail),
} as const;
