/** DOCX constants: MIME types, extensions, package paths, namespaces and safety limits. */

import type { DocxLimits } from "./types";

export const DOCX_EXTENSION = ".docx";
export const DOCX_EXTENSIONS = [DOCX_EXTENSION] as const;

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Recognised but rejected: macro-enabled documents are not supported by this workspace. */
export const DOCX_MACRO_MIME_TYPE = "application/vnd.ms-word.document.macroEnabled.12";
export const DOCX_TEMPLATE_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template";
/** Every MIME type that identifies a WordprocessingML package, supported or not. */
export const DOCX_MIME_TYPES = [
  DOCX_MIME_TYPE,
  DOCX_MACRO_MIME_TYPE,
  DOCX_TEMPLATE_MIME_TYPE,
] as const;

/**
 * MIME types accepted when the browser actually supplies one.
 * An empty type and `application/octet-stream` are accepted too, because browsers and
 * some OS file pickers report those for DOCX; the extension plus ZIP signature decide.
 */
export const DOCX_ACCEPTED_MIME_TYPES = [DOCX_MIME_TYPE] as const;
export const DOCX_UNKNOWN_MIME_TYPES = ["", "application/octet-stream"] as const;

/** Required OPC parts: without these the file is not a Word package. */
export const CONTENT_TYPES_PATH = "[Content_Types].xml";
export const DOCUMENT_PATH = "word/document.xml";
export const REQUIRED_DOCX_ENTRIES = [CONTENT_TYPES_PATH, DOCUMENT_PATH] as const;

/** Legitimate parts that Word normally writes. Their absence is a warning, not an error. */
export const PACKAGE_RELS_PATH = "_rels/.rels";
export const CORE_PROPERTIES_PATH = "docProps/core.xml";
export const APP_PROPERTIES_PATH = "docProps/app.xml";
export const RECOMMENDED_DOCX_ENTRIES = [
  PACKAGE_RELS_PATH,
  CORE_PROPERTIES_PATH,
  APP_PROPERTIES_PATH,
] as const;

export const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const CONTENT_TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types";
export const CORE_PROPERTIES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
export const EXTENDED_PROPERTIES_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
export const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";
export const DCTERMS_NAMESPACE = "http://purl.org/dc/terms/";

/**
 * Signatures checked before handing bytes to JSZip.
 * `PK\x03\x04` is a normal local-file header. The others indicate an empty or spanned archive,
 * which no real DOCX uses, so they are rejected as corrupted rather than parsed.
 */
export const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
export const ZIP_EMPTY_SIGNATURE = [0x50, 0x4b, 0x05, 0x06] as const;
export const ZIP_SPANNED_SIGNATURE = [0x50, 0x4b, 0x07, 0x08] as const;

/**
 * Compound File Binary header. Word writes password-protected `.docx` files as OLE containers,
 * so this signature means "encrypted", not "wrong format".
 */
export const OLE_CONTAINER_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/** 50 MiB. Large enough for real reports, small enough to keep memory use predictable. */
export const DEFAULT_DOCX_LIMITS: DocxLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxEntries: 2000,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 200,
};
