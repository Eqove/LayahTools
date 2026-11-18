/**
 * Fail-closed verification of a merged package.
 *
 * Structural checks are authoritative: package validation, body shape, relationship targets,
 * content types, numbering/style resolution, unique IDs, paragraph/table counts and in-order
 * `<w:t>` text. Mammoth is used only as a tolerant second opinion on extracted text; its known
 * limitations produce MERGE_TEXT_MISMATCH warnings, never false package failures.
 */

import {
  CONTENT_TYPES_PATH,
  DOCUMENT_PATH,
  DOCX_MIME_TYPE,
  WORD_NAMESPACE,
} from "../constants";
import { DocxErrors } from "../errors";
import { extractDocxText } from "../extract-text";
import type { DocxInput, DocxLimits, DocxPackage, DocxWarning } from "../types";
import { readDocxBytes, validateDocxFile } from "../validate";
import { parseXml } from "../xml";
import { readDocxEntry, readDocxEntryText } from "../zip";
import {
  collectBodyText,
  collapseWhitespace,
  countParagraphs,
  countTables,
} from "./body";
import type { DocxMergeVerification } from "./types";
import {
  OFFICE_RELATIONSHIPS_NAMESPACE,
  declaredContentType,
  directChildrenByLocalName,
  isPartTyped,
  parseContentTypes,
  parseNonNegativeInt,
  parseRelationships,
  readOptionalPartText,
  resolvePartTarget,
  relationshipTypeSuffix,
  wordAttribute,
} from "./package";

export interface MergeVerificationContext {
  outputBytes: Uint8Array;
  outputFileName: string;
  limits: DocxLimits;
  sourceTexts: readonly string[];
  sourceParagraphCounts: readonly number[];
  sourceTableCounts: readonly number[];
  expectedSectionBreaks: number;
  sourceStyleIds: ReadonlySet<string>;
  inputs: readonly DocxInput[];
  inputBytes: readonly Uint8Array[];
  inputNames: readonly string[];
  /** Absolute package paths expected to have been imported as image media. */
  importedMediaPaths: readonly string[];
  /** Exact external URLs expected to have been imported as hyperlink relationships. */
  importedHyperlinkTargets: readonly string[];
  /** Host bookmark count plus every imported bookmark. */
  expectedBookmarkCount: number;
  /** Bookmark IDs allocated by this merge; pairing is enforced for exactly these. */
  importedBookmarkIds: readonly number[];
  /** Receives MERGE_TEXT_MISMATCH warnings. */
  warnings: DocxWarning[];
}

const verificationFailure = (detail: string) =>
  DocxErrors.processingFailure(
    "The merged document could not be verified, so it was not returned.",
    detail
  );

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function requireBody(document: Document): Element {
  const bodies = document.getElementsByTagNameNS(WORD_NAMESPACE, "body");
  if (bodies.length === 0) throw verificationFailure("the merged document has no body");
  return bodies[0];
}

function collectRelationshipAttributes(document: Document): string[] {
  const values: string[] = [];
  const elements = document.getElementsByTagName("*");
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    for (let attributeIndex = 0; attributeIndex < element.attributes.length; attributeIndex++) {
      const attribute = element.attributes.item(attributeIndex);
      if (attribute && attribute.namespaceURI === OFFICE_RELATIONSHIPS_NAMESPACE) {
        values.push(attribute.value);
      }
    }
  }
  return values;
}

function collectStyleIds(stylesXml: string | null): Set<string> {
  const ids = new Set<string>();
  if (!stylesXml) return ids;

  const document = parseXml(stylesXml, "word/styles.xml (output)").document;
  const root = document.documentElement;
  if (root.localName !== "styles" || root.namespaceURI !== WORD_NAMESPACE) {
    throw verificationFailure("the merged styles part has an unexpected root element");
  }
  for (const style of directChildrenByLocalName(root, WORD_NAMESPACE, "style")) {
    const styleId = wordAttribute(style, "styleId");
    if (!styleId) throw verificationFailure("the merged styles part has a style with no styleId");
    if (ids.has(styleId)) {
      throw verificationFailure(`the merged styles part duplicates styleId ${styleId}`);
    }
    ids.add(styleId);
  }
  return ids;
}

/** Checks basedOn/next/link references inside the merged style definitions themselves. */
function validateStyleDefinitionReferences(stylesXml: string | null, sourceStyleIds: ReadonlySet<string>, outputIds: ReadonlySet<string>): void {
  if (!stylesXml) return;
  const document = parseXml(stylesXml, "word/styles.xml (output)").document;
  const root = document.documentElement;
  for (const style of directChildrenByLocalName(root, WORD_NAMESPACE, "style")) {
    for (const property of ["basedOn", "next", "link"]) {
      const reference = directChildrenByLocalName(style, WORD_NAMESPACE, property)[0];
      if (!reference) continue;
      const value = wordAttribute(reference, "val");
      if (value && sourceStyleIds.has(value) && !outputIds.has(value)) {
        throw verificationFailure(`style ${wordAttribute(style, "styleId") ?? "(unknown)"} references missing style ${value}`);
      }
    }
  }
}

function collectBodyStyleReferences(document: Document): Set<string> {
  const references = new Set<string>();
  for (const localName of ["pStyle", "rStyle", "tblStyle"]) {
    const elements = document.getElementsByTagNameNS(WORD_NAMESPACE, localName);
    for (let index = 0; index < elements.length; index++) {
      const value = wordAttribute(elements[index], "val");
      if (value) references.add(value);
    }
  }
  return references;
}

interface NumberingIds {
  numIds: Set<number>;
  abstractNumIds: Set<number>;
}

function collectNumberingIds(numberingXml: string | null): NumberingIds {
  const numIds = new Set<number>();
  const abstractNumIds = new Set<number>();
  if (!numberingXml) return { numIds, abstractNumIds };

  const document = parseXml(numberingXml, "word/numbering.xml (output)").document;
  const root = document.documentElement;
  if (root.localName !== "numbering" || root.namespaceURI !== WORD_NAMESPACE) {
    throw verificationFailure("the merged numbering part has an unexpected root element");
  }

  for (const abstract of directChildrenByLocalName(root, WORD_NAMESPACE, "abstractNum")) {
    const id = parseNonNegativeInt(wordAttribute(abstract, "abstractNumId"));
    if (id === null) throw verificationFailure("the merged numbering part has an invalid abstractNumId");
    if (abstractNumIds.has(id)) throw verificationFailure(`the merged numbering part duplicates abstractNumId ${id}`);
    abstractNumIds.add(id);
  }

  for (const num of directChildrenByLocalName(root, WORD_NAMESPACE, "num")) {
    const id = parseNonNegativeInt(wordAttribute(num, "numId"));
    if (id === null) throw verificationFailure("the merged numbering part has an invalid numId");
    if (numIds.has(id)) throw verificationFailure(`the merged numbering part duplicates numId ${id}`);
    numIds.add(id);

    const reference = directChildrenByLocalName(num, WORD_NAMESPACE, "abstractNumId")[0];
    const abstractId = reference ? parseNonNegativeInt(wordAttribute(reference, "val")) : null;
    if (abstractId === null || !abstractNumIds.has(abstractId)) {
      throw verificationFailure(`numId ${id} references missing abstractNumId ${abstractId ?? "(none)"}`);
    }
  }

  return { numIds, abstractNumIds };
}

function validateBodyNumberingReferences(document: Document, ids: NumberingIds): void {
  const references = document.getElementsByTagNameNS(WORD_NAMESPACE, "numId");
  for (let index = 0; index < references.length; index++) {
    const value = parseNonNegativeInt(wordAttribute(references[index], "val"));
    if (value === null) throw verificationFailure("the merged body has an invalid w:numId reference");
    if (value !== 0 && !ids.numIds.has(value)) {
      throw verificationFailure(`the merged body references missing numId ${value}`);
    }
  }
}

function validateNumberingStyleLinks(numberingXml: string | null, sourceStyleIds: ReadonlySet<string>, outputIds: ReadonlySet<string>): void {
  if (!numberingXml) return;
  const document = parseXml(numberingXml, "word/numbering.xml (output)").document;
  for (const localName of ["numStyleLink", "styleLink"]) {
    const elements = document.getElementsByTagNameNS(WORD_NAMESPACE, localName);
    for (let index = 0; index < elements.length; index++) {
      const value = wordAttribute(elements[index], "val");
      if (value && sourceStyleIds.has(value) && !outputIds.has(value)) {
        throw verificationFailure(`numbering references missing style ${value}`);
      }
    }
  }
}

interface RelationshipAudit {
  mediaPaths: Set<string>;
  hyperlinkTargets: string[];
}

async function validateRelationships(
  pkg: DocxPackage,
  document: Document,
  documentRelsXml: string | null,
  packagePaths: ReadonlySet<string>,
  limits: DocxLimits
): Promise<RelationshipAudit> {
  const relationships = documentRelsXml
    ? parseRelationships(documentRelsXml, `${DOCUMENT_PATH}.rels (output)`)
    : [];
  const byId = new Map<string, (typeof relationships)[number]>();
  for (const relationship of relationships) {
    if (byId.has(relationship.id)) {
      throw verificationFailure(`duplicate relationship ID ${relationship.id}`);
    }
    byId.set(relationship.id, relationship);
  }

  for (const id of collectRelationshipAttributes(document)) {
    if (!byId.has(id)) {
      throw verificationFailure(`body references missing relationship ${id}`);
    }
  }

  const mediaPaths = new Set<string>();
  const hyperlinkTargets: string[] = [];

  for (const relationship of relationships) {
    const suffix = relationshipTypeSuffix(relationship.type);
    if (relationship.targetMode === "External") {
      if (suffix === "hyperlink") hyperlinkTargets.push(relationship.target);
      continue;
    }

    const target = resolvePartTarget(DOCUMENT_PATH, relationship.target);
    if (!target || !packagePaths.has(target)) {
      throw verificationFailure(
        `relationship ${relationship.id} targets missing part ${relationship.target}`
      );
    }

    if (suffix === "image") {
      // Reading through the package limits proves the media bytes are present and readable.
      await readDocxEntry(pkg, target, limits);
      mediaPaths.add(target);
    } else if (suffix === "hyperlink") {
      throw verificationFailure(
        `hyperlink relationship ${relationship.id} is not marked external`
      );
    }
  }

  return { mediaPaths, hyperlinkTargets };
}

function validateContentTypes(
  contentTypesXml: string,
  entryNames: readonly string[],
  packagePaths: ReadonlySet<string>,
  mediaPaths: ReadonlySet<string>
): void {
  const manifest = parseContentTypes(contentTypesXml);
  for (const entry of entryNames) {
    if (!isPartTyped(manifest, entry)) {
      throw verificationFailure(`package entry ${entry} has no content type`);
    }
  }
  for (const partName of manifest.overrides.keys()) {
    if (!packagePaths.has(partName)) {
      throw verificationFailure(`content types declare missing part ${partName}`);
    }
  }
  for (const mediaPath of mediaPaths) {
    const contentType = declaredContentType(manifest, mediaPath);
    if (!contentType || !/^image\//i.test(contentType)) {
      throw verificationFailure(
        `media part ${mediaPath} has no image content type`
      );
    }
  }
}

/**
 * Validates bookmark IDs, start/end pairing, unique names and internal anchors.
 * Returns the number of bookmark starts.
 *
 * The host's own body is passed through untouched, so pairing is enforced for the bookmarks this
 * merge allocated. Host-only bookmarks are pre-existing content: the merge neither fixes nor
 * breaks them, and rejecting such a document would be a false failure. IDs and names are still
 * checked for global uniqueness, and every internal anchor must resolve in the merged document.
 */
function validateBookmarks(document: Document, importedBookmarkIds: ReadonlySet<number>): number {
  const bodies = document.getElementsByTagNameNS(WORD_NAMESPACE, "body");
  if (bodies.length === 0) throw verificationFailure("the merged document has no body");
  const body = bodies[0];

  const starts = body.getElementsByTagNameNS(WORD_NAMESPACE, "bookmarkStart");
  const ends = body.getElementsByTagNameNS(WORD_NAMESPACE, "bookmarkEnd");
  const startNames = new Map<number, string>();
  const names = new Set<string>();

  for (let index = 0; index < starts.length; index++) {
    const id = parseNonNegativeInt(wordAttribute(starts[index], "id"));
    const name = wordAttribute(starts[index], "name");
    if (id === null) throw verificationFailure("the merged body has a bookmark with an invalid ID");
    if (!name) throw verificationFailure("the merged body has a bookmark with no name");
    if (startNames.has(id)) throw verificationFailure(`the merged body duplicates bookmark ID ${id}`);
    if (names.has(name)) throw verificationFailure(`the merged body duplicates bookmark name ${name}`);
    startNames.set(id, name);
    names.add(name);
  }

  const endIds = new Set<number>();
  for (let index = 0; index < ends.length; index++) {
    const id = parseNonNegativeInt(wordAttribute(ends[index], "id"));
    if (id === null) throw verificationFailure("the merged body has a bookmark end with an invalid ID");
    if (endIds.has(id)) throw verificationFailure(`the merged body duplicates bookmark end ID ${id}`);
    endIds.add(id);
  }
  for (const id of startNames.keys()) {
    if (importedBookmarkIds.has(id) && !endIds.has(id)) {
      throw verificationFailure(`imported bookmark ${id} has no matching end`);
    }
  }
  for (const id of endIds) {
    if (importedBookmarkIds.has(id) && !startNames.has(id)) {
      throw verificationFailure(`imported bookmark end ${id} has no matching start`);
    }
  }

  const hyperlinks = body.getElementsByTagNameNS(WORD_NAMESPACE, "hyperlink");
  for (let index = 0; index < hyperlinks.length; index++) {
    const anchor = wordAttribute(hyperlinks[index], "anchor");
    if (anchor !== null && !names.has(anchor)) {
      throw verificationFailure(`internal hyperlink anchor "${anchor}" does not resolve`);
    }
  }

  return starts.length;
}

function validateNamespaces(document: Document): void {
  const root = document.documentElement;
  const ignorable = root.getAttributeNS(
    "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "Ignorable"
  );
  if (ignorable) {
    for (const token of ignorable.split(/\s+/).filter(Boolean)) {
      if (!root.getAttribute(`xmlns:${token}`)) {
        throw verificationFailure(`mc:Ignorable token "${token}" has no namespace declaration`);
      }
    }
  }

  const elements = document.getElementsByTagName("*");
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (element.prefix && element.prefix !== "xml") {
      const resolved = element.lookupNamespaceURI(element.prefix);
      if (resolved !== element.namespaceURI) {
        throw verificationFailure(
          `namespace prefix "${element.prefix}" on ${element.nodeName} does not resolve to its namespace`
        );
      }
    }
    for (let attributeIndex = 0; attributeIndex < element.attributes.length; attributeIndex++) {
      const attribute = element.attributes.item(attributeIndex);
      if (!attribute || !attribute.prefix) continue;
      if (attribute.prefix === "xmlns" || attribute.prefix === "xml") continue;
      const resolved = element.lookupNamespaceURI(attribute.prefix);
      if (resolved !== attribute.namespaceURI) {
        throw verificationFailure(
          `namespace prefix "${attribute.prefix}" on ${attribute.name} does not resolve to its namespace`
        );
      }
    }
  }
}

async function extractVerificationText(
  input: DocxInput,
  name: string,
  limits: DocxLimits
): Promise<string | null> {
  const result = await extractDocxText(input, { name, limits });
  if (!result.ok) return null;
  return collapseWhitespace(result.value.text);
}

async function validateTextPreservation(context: MergeVerificationContext): Promise<boolean> {
  const inputTexts: string[] = [];
  let inputCharacters = 0;

  for (let index = 0; index < context.inputs.length; index++) {
    const text = await extractVerificationText(
      context.inputs[index],
      context.inputNames[index],
      context.limits
    );
    if (text === null) {
      context.warnings.push({
        code: "MERGE_TEXT_MISMATCH",
        message: `"${context.inputNames[index]}" could not be re-extracted for text verification.`,
        detail: `${context.inputNames[index]}: Mammoth extraction failed`,
      });
      return false;
    }
    inputTexts.push(text);
    inputCharacters += text.replace(/\s+/g, "").length;
  }

  const extractedOutput = await extractVerificationText(
    context.outputBytes,
    context.outputFileName,
    context.limits
  );
  if (extractedOutput === null) {
    context.warnings.push({
      code: "MERGE_TEXT_MISMATCH",
      message: "The merged document could not be re-extracted for text verification.",
      detail: `${context.outputFileName}: Mammoth extraction failed`,
    });
    return false;
  }

  const outputCharacters = extractedOutput.replace(/\s+/g, "").length;
  if (inputCharacters > 0 && outputCharacters < inputCharacters * 0.5) {
    throw verificationFailure(
      `merged text is ${outputCharacters} characters, less than half of the ${inputCharacters} input characters`
    );
  }

  let cursor = 0;
  let preserved = true;
  for (let index = 0; index < inputTexts.length; index++) {
    const text = inputTexts[index];
    if (!text) continue;
    const found = extractedOutput.indexOf(text, cursor);
    if (found === -1) {
      preserved = false;
      context.warnings.push({
        code: "MERGE_TEXT_MISMATCH",
        message: `Extracted text from "${context.inputNames[index]}" was not found in the merged document.`,
        detail: `${context.inputNames[index]}: tolerant Mammoth comparison`,
      });
      continue;
    }
    cursor = found + text.length;
  }
  return preserved;
}

/**
 * Runs every structural check and returns the verification record.
 * Any failed check throws a PROCESSING_FAILURE; the caller returns no bytes.
 */
export async function verifyMerge(context: MergeVerificationContext): Promise<DocxMergeVerification> {
  const revalidated = await validateDocxFile(context.outputBytes, {
    name: context.outputFileName,
    mimeType: DOCX_MIME_TYPE,
    limits: context.limits,
  });
  if (!revalidated.ok) {
    throw verificationFailure(`${revalidated.error.code}: ${revalidated.error.message}`);
  }

  const pkg = revalidated.value.package;
  const document = revalidated.value.document;
  const body = requireBody(document);
  const packagePaths = new Set(pkg.info.entryNames);

  const bodySectPrs = directChildrenByLocalName(body, WORD_NAMESPACE, "sectPr");
  if (bodySectPrs.length > 1) {
    throw verificationFailure(`the merged body has ${bodySectPrs.length} body-level sectPr elements`);
  }
  if (bodySectPrs.length === 1) {
    const children = Array.from(body.childNodes).filter((node) => node.nodeType === 1);
    const last = children[children.length - 1];
    if (last !== bodySectPrs[0]) {
      throw verificationFailure("the body-level sectPr is not the last element in the body");
    }
  }

  const documentRelsXml = await readOptionalPartText(
    pkg,
    "word/_rels/document.xml.rels",
    context.limits
  );
  const relationshipAudit = await validateRelationships(
    pkg,
    document,
    documentRelsXml,
    packagePaths,
    context.limits
  );

  const contentTypesXml = await readDocxEntryText(pkg, CONTENT_TYPES_PATH, context.limits);
  validateContentTypes(
    contentTypesXml,
    pkg.info.entryNames,
    packagePaths,
    relationshipAudit.mediaPaths
  );

  for (const mediaPath of context.importedMediaPaths) {
    if (!packagePaths.has(mediaPath)) {
      throw verificationFailure(`imported media part ${mediaPath} is missing from the output`);
    }
    if (!relationshipAudit.mediaPaths.has(mediaPath)) {
      throw verificationFailure(`imported media part ${mediaPath} has no image relationship`);
    }
  }

  const expectedHyperlinks = new Map<string, number>();
  for (const target of context.importedHyperlinkTargets) {
    expectedHyperlinks.set(target, (expectedHyperlinks.get(target) ?? 0) + 1);
  }
  const actualHyperlinks = new Map<string, number>();
  for (const target of relationshipAudit.hyperlinkTargets) {
    actualHyperlinks.set(target, (actualHyperlinks.get(target) ?? 0) + 1);
  }
  for (const [target, count] of expectedHyperlinks) {
    if ((actualHyperlinks.get(target) ?? 0) < count) {
      throw verificationFailure(`imported hyperlink target "${target}" is missing or not external`);
    }
  }

  const bookmarkCount = validateBookmarks(document, new Set(context.importedBookmarkIds));
  if (bookmarkCount !== context.expectedBookmarkCount) {
    throw verificationFailure(
      `the merged body has ${bookmarkCount} bookmarks; expected ${context.expectedBookmarkCount}`
    );
  }
  validateNamespaces(document);

  const numberingXml = await readOptionalPartText(pkg, "word/numbering.xml", context.limits);
  const numberingIds = collectNumberingIds(numberingXml);
  validateBodyNumberingReferences(document, numberingIds);

  const stylesXml = await readOptionalPartText(pkg, "word/styles.xml", context.limits);
  const outputStyleIds = collectStyleIds(stylesXml);
  validateStyleDefinitionReferences(stylesXml, context.sourceStyleIds, outputStyleIds);
  validateNumberingStyleLinks(numberingXml, context.sourceStyleIds, outputStyleIds);

  for (const reference of collectBodyStyleReferences(document)) {
    if (context.sourceStyleIds.has(reference) && !outputStyleIds.has(reference)) {
      throw verificationFailure(`the merged body references missing style ${reference}`);
    }
  }

  const outputParagraphs = countParagraphs(body);
  const expectedParagraphs = sum(context.sourceParagraphCounts) + context.expectedSectionBreaks;
  if (outputParagraphs !== expectedParagraphs) {
    throw verificationFailure(
      `paragraph count is ${outputParagraphs}; expected ${expectedParagraphs}`
    );
  }

  const outputTables = countTables(body);
  const expectedTables = sum(context.sourceTableCounts);
  if (outputTables !== expectedTables) {
    throw verificationFailure(`table count is ${outputTables}; expected ${expectedTables}`);
  }

  const outputText = collapseWhitespace(collectBodyText(document));
  let cursor = 0;
  for (let index = 0; index < context.sourceTexts.length; index++) {
    const text = collapseWhitespace(context.sourceTexts[index]);
    if (!text) continue;
    const found = outputText.indexOf(text, cursor);
    if (found === -1) {
      throw verificationFailure(
        `text from source ${index + 1} did not survive in order in the merged body`
      );
    }
    cursor = found + text.length;
  }

  for (let index = 0; index < context.inputs.length; index++) {
    const current = await readDocxBytes(context.inputs[index]);
    if (!bytesEqual(current, context.inputBytes[index])) {
      throw verificationFailure(`input "${context.inputNames[index]}" changed during the merge`);
    }
  }

  const textPreserved = await validateTextPreservation(context);

  return {
    packageValid: true,
    documentBodyValid: true,
    paragraphOrderPreserved: true,
    numberingResolved: true,
    styleReferencesResolved: true,
    idsUnique: true,
    contentTypesComplete: true,
    relationshipsResolved: true,
    mediaPreserved: true,
    hyperlinksPreserved: true,
    bookmarksValid: true,
    namespacesValid: true,
    inputsUnchanged: true,
    textPreserved,
  };
}
