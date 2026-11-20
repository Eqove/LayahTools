/**
 * Removal of the document properties this workspace exposes.
 *
 * Scope is deliberately narrow. Only the fields that `readDocxMetadata` reports are removed, and
 * only from `docProps/core.xml` and `docProps/app.xml`. Everything else — custom properties,
 * thumbnails, embedded objects, revision traces and the document body itself — is left exactly
 * as it was.
 *
 * The result is never trusted on faith: the generated package is re-validated, re-read with the
 * same metadata reader, and every untouched part is compared byte for byte before it is returned.
 * A package that fails any of those checks is reported as a processing failure instead.
 */

import {
  APP_PROPERTIES_PATH,
  CORE_PROPERTIES_NAMESPACE,
  CORE_PROPERTIES_PATH,
  DC_NAMESPACE,
  DCTERMS_NAMESPACE,
  DEFAULT_DOCX_LIMITS,
  DOCUMENT_PATH,
  DOCX_MIME_TYPE,
  EXTENDED_PROPERTIES_NAMESPACE,
} from "./constants";
import { DocxError, DocxErrors, toDocxError } from "./errors";
import { readMetadataFromPackage } from "./metadata";
import type {
  DocxInput,
  DocxLimits,
  DocxMetadata,
  DocxPackage,
  DocxProcessingResult,
  DocxWarning,
} from "./types";
import { validateDocxFile, type DocxValidateOptions } from "./validate";
import { parseXml, serializeXml } from "./xml";
import { openDocxPackage, readDocxEntry, readDocxEntryText, saveDocxPackage } from "./zip";

export const DOCX_CLEANED_FALLBACK_NAME = "document-cleaned.docx";

/** One supported property, mapped to the part and element that carries it. */
interface MetadataFieldSpec {
  field: keyof DocxMetadata;
  namespace: string;
  localName: string;
}

interface MetadataPartSpec {
  path: string;
  rootLocalName: string;
  rootNamespace: string;
  fields: readonly MetadataFieldSpec[];
}

const CORE_FIELDS: readonly MetadataFieldSpec[] = [
  { field: "title", namespace: DC_NAMESPACE, localName: "title" },
  { field: "subject", namespace: DC_NAMESPACE, localName: "subject" },
  { field: "creator", namespace: DC_NAMESPACE, localName: "creator" },
  { field: "description", namespace: DC_NAMESPACE, localName: "description" },
  { field: "keywords", namespace: CORE_PROPERTIES_NAMESPACE, localName: "keywords" },
  { field: "lastModifiedBy", namespace: CORE_PROPERTIES_NAMESPACE, localName: "lastModifiedBy" },
  { field: "revision", namespace: CORE_PROPERTIES_NAMESPACE, localName: "revision" },
  { field: "category", namespace: CORE_PROPERTIES_NAMESPACE, localName: "category" },
  { field: "created", namespace: DCTERMS_NAMESPACE, localName: "created" },
  { field: "modified", namespace: DCTERMS_NAMESPACE, localName: "modified" },
];

const APP_FIELDS: readonly MetadataFieldSpec[] = [
  { field: "application", namespace: EXTENDED_PROPERTIES_NAMESPACE, localName: "Application" },
  { field: "applicationVersion", namespace: EXTENDED_PROPERTIES_NAMESPACE, localName: "AppVersion" },
  { field: "company", namespace: EXTENDED_PROPERTIES_NAMESPACE, localName: "Company" },
  { field: "manager", namespace: EXTENDED_PROPERTIES_NAMESPACE, localName: "Manager" },
  { field: "pages", namespace: EXTENDED_PROPERTIES_NAMESPACE, localName: "Pages" },
  { field: "words", namespace: EXTENDED_PROPERTIES_NAMESPACE, localName: "Words" },
  { field: "characters", namespace: EXTENDED_PROPERTIES_NAMESPACE, localName: "Characters" },
];

const METADATA_PARTS: readonly MetadataPartSpec[] = [
  {
    path: CORE_PROPERTIES_PATH,
    rootLocalName: "coreProperties",
    rootNamespace: CORE_PROPERTIES_NAMESPACE,
    fields: CORE_FIELDS,
  },
  {
    path: APP_PROPERTIES_PATH,
    rootLocalName: "Properties",
    rootNamespace: EXTENDED_PROPERTIES_NAMESPACE,
    fields: APP_FIELDS,
  },
];

/** Every metadata field this module is allowed to remove. Nothing outside this list is touched. */
export const SUPPORTED_METADATA_FIELDS: readonly (keyof DocxMetadata)[] = METADATA_PARTS.flatMap(
  (part) => part.fields.map((spec) => spec.field)
);

/** A supported property that was removed, identified without exposing the value it held. */
export interface DocxMetadataProperty {
  /** Field name as exposed by `readDocxMetadata`. */
  field: keyof DocxMetadata;
  /** Package part the element lived in. */
  part: string;
  /** Element name as written in the part, e.g. `dc:title`. */
  element: string;
}

/** A property outside supported coverage that is still present in the output. */
export interface DocxRetainedProperty {
  part: string;
  /** Element name as written, e.g. `cp:lastPrinted`. */
  element: string;
  /** Whether it currently holds a value. Values are never exposed. */
  valuePresent: boolean;
}

/** What was actually checked before the result was returned. All fields are true on success. */
export interface DocxCleanupVerification {
  /** The generated package passed full DOCX validation. */
  packageValid: boolean;
  /** Re-reading the output found no supported metadata element or field. */
  metadataRemovalConfirmed: boolean;
  /** `word/document.xml` is byte-identical to the input. */
  documentContentUnchanged: boolean;
  /** Every package entry that was not deliberately rewritten is byte-identical to the input. */
  otherPartsUnchanged: boolean;
}

export interface DocxMetadataCleanup {
  /** Original upload name. */
  fileName: string;
  /** Suggested download name: `example.docx` becomes `example-cleaned.docx`. */
  outputFileName: string;
  mimeType: typeof DOCX_MIME_TYPE;
  bytes: Uint8Array;
  /** Browser-ready Blob with the DOCX MIME type. */
  blob: Blob;
  byteLength: number;
  /** Supported properties that held a value and were removed. */
  removedProperties: DocxMetadataProperty[];
  /**
   * Supported elements that existed but held no value. They are removed too, so the output carries
   * no supported elements at all, but they never carried information and are not counted above.
   */
  emptyProperties: DocxMetadataProperty[];
  /** Properties outside supported coverage that remain in the file. */
  retainedProperties: DocxRetainedProperty[];
  /** Metadata-bearing parts outside supported coverage that were left untouched. */
  retainedParts: string[];
  /** Parts this module rewrote. Empty when there was nothing to remove. */
  modifiedParts: string[];
  verification: DocxCleanupVerification;
  warnings: DocxWarning[];
}

/**
 * Derives the download name.
 *
 * Only a trailing `.docx` is replaced, so `archive.tar.docx` becomes `archive.tar-cleaned.docx`
 * and the rest of the name is preserved verbatim.
 */
export function toCleanedDocxFileName(fileName: string): string {
  const name = fileName.trim();
  if (!name) return DOCX_CLEANED_FALLBACK_NAME;

  const match = /^(.*)\.docx$/i.exec(name);
  if (match && match[1].trim().length > 0) return `${match[1]}-cleaned.docx`;
  if (match) return DOCX_CLEANED_FALLBACK_NAME;
  return `${name}-cleaned.docx`;
}

const isElement = (node: Node): node is Element => node.nodeType === 1;

/** Namespace-qualified identity, so a `dc:title` never matches an unrelated `cp:title`. */
const elementKey = (namespace: string | null | undefined, localName: string | null | undefined): string =>
  `${namespace ?? ""}|${localName ?? ""}`;

const hasValue = (element: Element): boolean => Boolean(element.textContent?.trim());

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

interface PartCleanup {
  path: string;
  removed: DocxMetadataProperty[];
  empty: DocxMetadataProperty[];
  retained: DocxRetainedProperty[];
  /** Serialised part, present only when at least one element was actually removed. */
  xml?: string;
}

/**
 * Removes supported elements from one metadata part.
 *
 * Anything that is not a supported field is recorded as retained and left in place. The part's
 * root element is checked first: a part this module does not recognise is never rewritten.
 */
function cleanMetadataPart(part: MetadataPartSpec, source: string): PartCleanup {
  let document: Document;
  try {
    document = parseXml(source, part.path).document;
  } catch (error) {
    const cause = toDocxError(error);
    throw new DocxError(
      cause.code,
      `The document properties in ${part.path} could not be read safely, so nothing was changed.`,
      cause.detail
    );
  }

  const root = document.documentElement;
  if (root.localName !== part.rootLocalName || root.namespaceURI !== part.rootNamespace) {
    throw DocxErrors.unsupportedStructure(
      `The document properties part ${part.path} is not the expected kind of file, so it was not changed.`,
      `root: ${root.nodeName} (${root.namespaceURI ?? "no namespace"})`
    );
  }

  const removed: DocxMetadataProperty[] = [];
  const empty: DocxMetadataProperty[] = [];
  const retained: DocxRetainedProperty[] = [];
  const fieldsByKey = new Map(
    part.fields.map((spec) => [elementKey(spec.namespace, spec.localName), spec])
  );

  // Property parts are flat in the OOXML schemas, so direct children are the whole story.
  for (const child of Array.from(root.childNodes).filter(isElement)) {
    const key = elementKey(child.namespaceURI, child.localName);
    const spec = fieldsByKey.get(key);

    if (!spec) {
      retained.push({ part: part.path, element: child.nodeName, valuePresent: hasValue(child) });
      continue;
    }

    const property: DocxMetadataProperty = {
      field: spec.field,
      part: part.path,
      element: child.nodeName,
    };
    if (hasValue(child)) removed.push(property);
    else empty.push(property);

    root.removeChild(child);
  }

  // Guard against a supported element hiding somewhere unexpected: if one survives, the part is
  // not shaped the way we assumed and silently returning it would be wrong.
  for (const spec of part.fields) {
    const survivors = root.getElementsByTagNameNS(spec.namespace, spec.localName);
    if (survivors.length > 0) {
      throw DocxErrors.processingFailure(
        `A supported property in ${part.path} could not be located for removal.`,
        `${part.path}: ${spec.localName} x${survivors.length}`
      );
    }
  }

  if (removed.length === 0 && empty.length === 0) {
    return { path: part.path, removed, empty, retained };
  }

  const xml = serializeXml(document);
  try {
    parseXml(xml, `${part.path} (rewritten)`);
  } catch (error) {
    throw DocxErrors.processingFailure(
      `The cleaned document properties in ${part.path} could not be serialised safely.`,
      toDocxError(error).detail
    );
  }

  return { path: part.path, removed, empty, retained, xml };
}

/** Fails the whole operation rather than returning a package that could not be verified. */
function verificationFailure(detail: string): DocxError {
  return DocxErrors.processingFailure(
    "The cleaned document could not be verified, so it was not returned.",
    detail
  );
}

async function verifyCleanup(
  pkg: DocxPackage,
  outputBytes: Uint8Array,
  outputFileName: string,
  limits: DocxLimits,
  modifiedParts: ReadonlySet<string>
): Promise<DocxCleanupVerification> {
  const revalidated = await validateDocxFile(outputBytes, {
    name: outputFileName,
    mimeType: DOCX_MIME_TYPE,
    limits,
  });
  if (!revalidated.ok) {
    throw verificationFailure(`${revalidated.error.code}: ${revalidated.error.message}`);
  }

  const outputPkg = await openDocxPackage(outputBytes, limits);

  const namesMatch =
    outputPkg.info.entryNames.length === pkg.info.entryNames.length &&
    outputPkg.info.entryNames.every((name, index) => name === pkg.info.entryNames[index]);
  if (!namesMatch) {
    throw verificationFailure("the cleaned package contains a different set of entries");
  }

  // Structural check: no supported element may survive, even an empty one.
  for (const part of METADATA_PARTS) {
    if (!outputPkg.zip.file(part.path)) continue;
    const document = parseXml(await readDocxEntryText(outputPkg, part.path, limits), part.path).document;
    for (const spec of part.fields) {
      if (document.getElementsByTagNameNS(spec.namespace, spec.localName).length > 0) {
        throw verificationFailure(`${part.path} still contains ${spec.localName}`);
      }
    }
  }

  // Reader-level check: whatever `readDocxMetadata` used to report must be gone.
  const after = await readMetadataFromPackage(outputPkg, limits);
  const survivors = SUPPORTED_METADATA_FIELDS.filter((field) => after.metadata[field] !== undefined);
  if (survivors.length > 0) {
    throw verificationFailure(`metadata still readable: ${survivors.join(", ")}`);
  }

  const documentBefore = await readDocxEntry(pkg, DOCUMENT_PATH, limits);
  const documentAfter = await readDocxEntry(outputPkg, DOCUMENT_PATH, limits);
  if (!bytesEqual(documentBefore, documentAfter)) {
    throw verificationFailure(`${DOCUMENT_PATH} changed`);
  }

  for (const name of outputPkg.info.entryNames) {
    if (modifiedParts.has(name)) continue;
    const before = await readDocxEntry(pkg, name, limits);
    const afterBytes = await readDocxEntry(outputPkg, name, limits);
    if (!bytesEqual(before, afterBytes)) {
      throw verificationFailure(`package entry ${name} changed`);
    }
  }

  return {
    packageValid: true,
    metadataRemovalConfirmed: true,
    documentContentUnchanged: true,
    otherPartsUnchanged: true,
  };
}

/**
 * Removes the supported document properties and returns a new DOCX.
 *
 * The input is never modified: bytes are copied on read and the rebuilt package is a new array.
 * Validation failures are returned unchanged. Malformed metadata XML fails the operation instead
 * of producing a document that might no longer open.
 */
export async function removeSupportedDocxMetadata(
  input: DocxInput,
  options: DocxValidateOptions = {}
): Promise<DocxProcessingResult<DocxMetadataCleanup>> {
  const limits = options.limits ?? DEFAULT_DOCX_LIMITS;
  const validated = await validateDocxFile(input, { ...options, limits });
  if (!validated.ok) return validated;

  const { info, package: pkg } = validated.value;
  const warnings = [...validated.warnings];

  try {
    // 1. Inspect first, using the same reader the UI shows, so "removed" means "no longer reported".
    const before = await readMetadataFromPackage(pkg, limits);
    warnings.push(...before.warnings);

    // 2. Clean every present metadata part in memory before touching the package.
    const results: PartCleanup[] = [];
    for (const part of METADATA_PARTS) {
      if (!pkg.zip.file(part.path)) continue;
      results.push(cleanMetadataPart(part, await readDocxEntryText(pkg, part.path, limits)));
    }

    const modifiedParts = results.filter((result) => result.xml !== undefined).map((result) => result.path);
    for (const result of results) {
      if (result.xml !== undefined) pkg.zip.file(result.path, result.xml);
    }

    // 3. Build the new package. `pkg` belongs to this call; the caller's bytes are never touched.
    const bytes = (await saveDocxPackage(pkg, { limits })).bytes;

    // 4. Prove the output before handing it back.
    const outputFileName = toCleanedDocxFileName(info.name);
    const verification = await verifyCleanup(
      pkg,
      bytes,
      outputFileName,
      limits,
      new Set(modifiedParts)
    );

    const retainedParts = pkg.info.entryNames.filter(
      (name) => name.startsWith("docProps/") && !METADATA_PARTS.some((part) => part.path === name)
    );
    if (retainedParts.length > 0) {
      warnings.push({
        code: "METADATA_RETAINED",
        message: "Some document property parts are outside this tool's coverage and were left unchanged.",
        detail: retainedParts.join(", "),
      });
    }

    const value: DocxMetadataCleanup = {
      fileName: info.name,
      outputFileName,
      mimeType: DOCX_MIME_TYPE,
      bytes,
      blob: new Blob([bytes as BlobPart], { type: DOCX_MIME_TYPE }),
      byteLength: bytes.length,
      removedProperties: results.flatMap((result) => result.removed),
      emptyProperties: results.flatMap((result) => result.empty),
      retainedProperties: results.flatMap((result) => result.retained),
      retainedParts,
      modifiedParts,
      verification,
      warnings,
    };

    return { ok: true, value, warnings };
  } catch (error) {
    return { ok: false, error: toDocxError(error), warnings };
  }
}
