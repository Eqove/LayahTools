/**
 * DOCX metadata inspection.
 *
 * Reads `docProps/core.xml` and `docProps/app.xml` only. Nothing is rendered as XML and no raw
 * part is exposed: values are returned as plain strings, normalised ISO dates and numbers.
 *
 * Statistical fields (pages, words, characters) come from Word's last save and are advisory.
 * They are reported as-is and never used to make processing decisions.
 */

import {
  APP_PROPERTIES_PATH,
  CORE_PROPERTIES_NAMESPACE,
  CORE_PROPERTIES_PATH,
  DC_NAMESPACE,
  DCTERMS_NAMESPACE,
  DEFAULT_DOCX_LIMITS,
  EXTENDED_PROPERTIES_NAMESPACE,
} from "./constants";
import { toDocxError } from "./errors";
import type {
  DocxInput,
  DocxLimits,
  DocxMetadata,
  DocxPackage,
  DocxProcessingResult,
  DocxWarning,
} from "./types";
import { validateDocxFile, type DocxValidateOptions } from "./validate";
import { findElement, parseXml } from "./xml";
import { readDocxEntryText } from "./zip";

export interface DocxMetadataRead {
  metadata: DocxMetadata;
  warnings: DocxWarning[];
}

const propertyText = (document: Document, namespace: string, localName: string): string | undefined => {
  const value = findElement(document, namespace, localName)?.textContent?.trim();
  return value ? value : undefined;
};

const propertyNumber = (document: Document, namespace: string, localName: string): number | undefined => {
  const value = propertyText(document, namespace, localName);
  // Strict digits only: "1,200" and "many" are dropped rather than parsed as 1 or NaN.
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

/** Assigns only real values, so absent properties are truly absent instead of `undefined` keys. */
const assign = <K extends keyof DocxMetadata>(metadata: DocxMetadata, key: K, value: DocxMetadata[K] | undefined) => {
  if (value !== undefined) metadata[key] = value;
};

/**
 * Normalises a W3CDTF/ISO date into an ISO 8601 UTC string.
 *
 * Values without a timezone are read as UTC rather than local time, so the same document does
 * not produce different timestamps in different timezones. Unparseable values yield undefined.
 */
export function normalizeMetadataDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const candidate = hasZone ? trimmed : dateOnly ? `${trimmed}T00:00:00Z` : `${trimmed}Z`;
  const time = Date.parse(candidate);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * Reads metadata from an opened package.
 *
 * Missing property parts are not an error and produce no warning here; package-level callers
 * already report missing parts during validation. Malformed XML and unusable values do produce
 * warnings, and are never allowed to fail the document.
 */
export async function readMetadataFromPackage(
  pkg: DocxPackage,
  limits: DocxLimits = DEFAULT_DOCX_LIMITS
): Promise<DocxMetadataRead> {
  const metadata: DocxMetadata = {};
  const warnings: DocxWarning[] = [];

  const setDate = (field: "created" | "modified", raw: string | undefined, part: string) => {
    if (!raw) return;
    const iso = normalizeMetadataDate(raw);
    if (!iso) {
      warnings.push({
        code: "INVALID_METADATA_VALUE",
        message: `The ${field} date in document properties is not a valid date.`,
        detail: `${part}: ${raw}`,
      });
      return;
    }
    metadata[field] = iso;
  };

  if (pkg.zip.file(CORE_PROPERTIES_PATH)) {
    try {
      const core = parseXml(await readDocxEntryText(pkg, CORE_PROPERTIES_PATH, limits), CORE_PROPERTIES_PATH);
      warnings.push(...core.warnings);

      assign(metadata, "title", propertyText(core.document, DC_NAMESPACE, "title"));
      assign(metadata, "subject", propertyText(core.document, DC_NAMESPACE, "subject"));
      assign(metadata, "creator", propertyText(core.document, DC_NAMESPACE, "creator"));
      assign(metadata, "description", propertyText(core.document, DC_NAMESPACE, "description"));
      assign(metadata, "keywords", propertyText(core.document, CORE_PROPERTIES_NAMESPACE, "keywords"));
      assign(metadata, "lastModifiedBy", propertyText(core.document, CORE_PROPERTIES_NAMESPACE, "lastModifiedBy"));
      assign(metadata, "revision", propertyText(core.document, CORE_PROPERTIES_NAMESPACE, "revision"));
      assign(metadata, "category", propertyText(core.document, CORE_PROPERTIES_NAMESPACE, "category"));
      setDate("created", propertyText(core.document, DCTERMS_NAMESPACE, "created"), CORE_PROPERTIES_PATH);
      setDate("modified", propertyText(core.document, DCTERMS_NAMESPACE, "modified"), CORE_PROPERTIES_PATH);
    } catch (error) {
      warnings.push({
        code: "MALFORMED_METADATA",
        message: "Core document properties could not be read.",
        detail: toDocxError(error).detail ?? CORE_PROPERTIES_PATH,
      });
    }
  }

  if (pkg.zip.file(APP_PROPERTIES_PATH)) {
    try {
      const app = parseXml(await readDocxEntryText(pkg, APP_PROPERTIES_PATH, limits), APP_PROPERTIES_PATH);
      warnings.push(...app.warnings);

      assign(metadata, "application", propertyText(app.document, EXTENDED_PROPERTIES_NAMESPACE, "Application"));
      assign(metadata, "applicationVersion", propertyText(app.document, EXTENDED_PROPERTIES_NAMESPACE, "AppVersion"));
      assign(metadata, "company", propertyText(app.document, EXTENDED_PROPERTIES_NAMESPACE, "Company"));
      assign(metadata, "manager", propertyText(app.document, EXTENDED_PROPERTIES_NAMESPACE, "Manager"));
      assign(metadata, "pages", propertyNumber(app.document, EXTENDED_PROPERTIES_NAMESPACE, "Pages"));
      assign(metadata, "words", propertyNumber(app.document, EXTENDED_PROPERTIES_NAMESPACE, "Words"));
      assign(metadata, "characters", propertyNumber(app.document, EXTENDED_PROPERTIES_NAMESPACE, "Characters"));
    } catch (error) {
      warnings.push({
        code: "MALFORMED_METADATA",
        message: "Extended document properties could not be read.",
        detail: toDocxError(error).detail ?? APP_PROPERTIES_PATH,
      });
    }
  }

  return { metadata, warnings };
}

/**
 * Validates a DOCX and returns its document properties.
 *
 * Missing parts are reported by validation as `MISSING_METADATA`; malformed parts are reported
 * as `MALFORMED_METADATA` without failing the document. Only an invalid package fails.
 */
export async function readDocxMetadata(
  input: DocxInput,
  options: DocxValidateOptions = {}
): Promise<DocxProcessingResult<DocxMetadata>> {
  const validation = await validateDocxFile(input, options);
  if (!validation.ok) {
    return { ok: false, error: validation.error, warnings: validation.warnings };
  }

  const limits = options.limits ?? DEFAULT_DOCX_LIMITS;
  const parsed = await readMetadataFromPackage(validation.value.package, limits);
  const warnings = [...validation.warnings, ...parsed.warnings];

  return { ok: true, value: parsed.metadata, warnings };
}
