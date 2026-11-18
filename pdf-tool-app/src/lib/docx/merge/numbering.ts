/**
 * Numbering reconciliation.
 *
 * Every imported abstractNum and num receives a freshly allocated numeric ID. IDs are numbers,
 * never concatenated strings: `1` + `10` and `11` + `0` cannot collide. All `w:numId` references
 * in imported body content are rewritten through the per-document map, and `w:num`'s
 * `w:abstractNumId` child is rewritten through the abstract map.
 */

import { WORD_NAMESPACE } from "../constants";
import { DocxErrors, toDocxError } from "../errors";
import { parseXml, serializeXml } from "../xml";
import {
  directChildByLocalName,
  directChildrenByLocalName,
  parseNonNegativeInt,
  setWordAttribute,
  wordAttribute,
} from "./package";

export interface NumberingSource {
  fileName: string;
  document: Document;
  numberingXml: string | null;
}

export interface NumberingMergeResult {
  /** Rewritten numbering.xml, present only when at least one definition was imported. */
  xml?: string;
  /** Per non-host source: old numId -> new numId. Empty when the source has no numbering. */
  numIdMaps: ReadonlyMap<number, number>[];
  /** Imported `w:num` count per non-host source. */
  importedNum: number[];
  /** Imported `w:abstractNum` count per non-host source. */
  importedAbstractNum: number[];
  /** `w:num` + `w:abstractNum` elements in the merged part. */
  numberingDefinitions: number;
}

function numberingRoot(document: Document, context: string): Element {
  const root = document.documentElement;
  if (root.localName !== "numbering" || root.namespaceURI !== WORD_NAMESPACE) {
    throw DocxErrors.unsupportedStructure(
      `${context} is not a WordprocessingML numbering part.`,
      `root: ${root.nodeName} (${root.namespaceURI ?? "no namespace"})`
    );
  }
  return root;
}

function collectById(
  root: Element,
  localName: string,
  attributeName: string,
  context: string
): Map<number, Element> {
  const definitions = new Map<number, Element>();
  for (const element of directChildrenByLocalName(root, WORD_NAMESPACE, localName)) {
    const id = parseNonNegativeInt(wordAttribute(element, attributeName));
    if (id === null) {
      throw DocxErrors.unsupportedStructure(
        `${context} contains a ${element.nodeName} with a missing or invalid ${attributeName}.`,
        `element: ${element.nodeName}`
      );
    }
    if (definitions.has(id)) {
      throw DocxErrors.unsupportedStructure(
        `${context} defines ${element.nodeName} ${id} more than once.`,
        `duplicate ${attributeName}: ${id}`
      );
    }
    definitions.set(id, element);
  }
  return definitions;
}

function validateAbstractReferences(
  nums: ReadonlyMap<number, Element>,
  abstractIds: ReadonlySet<number>,
  context: string
): void {
  for (const [numId, num] of nums) {
    const reference = directChildByLocalName(num, WORD_NAMESPACE, "abstractNumId");
    const abstractId = reference
      ? parseNonNegativeInt(wordAttribute(reference, "val"))
      : null;
    if (abstractId === null || !abstractIds.has(abstractId)) {
      throw DocxErrors.unsupportedStructure(
        `${context} has a numbering instance that references a missing abstract definition.`,
        `numId ${numId} -> abstractNumId ${abstractId ?? "(missing)"}`
      );
    }
  }
}

/** Every non-zero `w:numId` that appears in the document body. */
function collectBodyNumberReferences(document: Document, context: string): Set<number> {
  const references = new Set<number>();
  const elements = document.getElementsByTagNameNS(WORD_NAMESPACE, "numId");
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const raw = wordAttribute(element, "val");
    const value = parseNonNegativeInt(raw);
    if (value === null) {
      throw DocxErrors.unsupportedStructure(
        `${context} contains a numbering reference with a missing or invalid value.`,
        `w:numId value: ${raw ?? "(missing)"}`
      );
    }
    if (value !== 0) references.add(value);
  }
  return references;
}

function unsupportedPictureBullet(context: string): never {
  throw DocxErrors.unsupportedStructure(
    `${context} uses picture bullets, which the merge cannot preserve yet.`,
    "w:numPicBullet / w:lvlPicBulletId / relationship reference"
  );
}

function rejectRelationshipDependentNumbering(root: Element, context: string): void {
  if (root.getElementsByTagNameNS(WORD_NAMESPACE, "numPicBullet").length > 0) {
    unsupportedPictureBullet(context);
  }
  if (root.getElementsByTagNameNS(WORD_NAMESPACE, "lvlPicBulletId").length > 0) {
    unsupportedPictureBullet(context);
  }

  const elements = root.getElementsByTagName("*");
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    for (let attributeIndex = 0; attributeIndex < element.attributes.length; attributeIndex++) {
      const attribute = element.attributes.item(attributeIndex);
      if (attribute && attribute.namespaceURI === "http://schemas.openxmlformats.org/officeDocument/2006/relationships") {
        unsupportedPictureBullet(context);
      }
    }
  }
}

function insertAbstract(root: Element, node: Element): void {
  const firstNum = directChildrenByLocalName(root, WORD_NAMESPACE, "num")[0];
  if (firstNum) {
    root.insertBefore(node, firstNum);
    return;
  }
  const cleanup = directChildByLocalName(root, WORD_NAMESPACE, "numIdMacAtCleanup");
  if (cleanup) root.insertBefore(node, cleanup);
  else root.appendChild(node);
}

function insertNum(root: Element, node: Element): void {
  const cleanup = directChildByLocalName(root, WORD_NAMESPACE, "numIdMacAtCleanup");
  if (cleanup) root.insertBefore(node, cleanup);
  else root.appendChild(node);
}

/** Rewrites `w:numId` descendants through a map. Zero means "no numbering" and is left alone. */
function rewriteNumberReferences(
  node: Node,
  map: ReadonlyMap<number, number>,
  context: string
): void {
  if (node.nodeType !== 1) return;
  const descendants = (node as Element).getElementsByTagNameNS(WORD_NAMESPACE, "numId");
  for (let index = 0; index < descendants.length; index++) {
    const element = descendants[index];
    const value = parseNonNegativeInt(wordAttribute(element, "val"));
    if (value === null) {
      throw DocxErrors.unsupportedStructure(
        `${context} contains a numbering reference with a missing or invalid value.`,
        `w:numId value: ${wordAttribute(element, "val") ?? "(missing)"}`
      );
    }
    if (value === 0) continue;
    const mapped = map.get(value);
    if (mapped === undefined) {
      throw DocxErrors.unsupportedStructure(
        `${context} references a numbering definition that does not exist.`,
        `numId: ${value}`
      );
    }
    setWordAttribute(element, "val", String(mapped));
  }
}

function nextId(used: ReadonlySet<number>, minimum: number): number {
  let candidate = used.size === 0 ? minimum : Math.max(...used) + 1;
  while (used.has(candidate)) candidate++;
  if (!Number.isSafeInteger(candidate)) {
    throw DocxErrors.unsupportedStructure("The document uses too many numbering definitions to merge.");
  }
  return candidate;
}

/**
 * Merges numbering definitions from later documents into the host's numbering part.
 * The host numbering part itself is never replaced; imported definitions are appended in schema
 * order (abstractNum before num, num before numIdMacAtCleanup).
 */
export function mergeNumbering(
  hostNumberingXml: string | null,
  sources: readonly NumberingSource[]
): NumberingMergeResult {
  const numIdMaps: ReadonlyMap<number, number>[] = [];
  const importedNum = sources.map(() => 0);
  const importedAbstractNum = sources.map(() => 0);

  const hostDocument = hostNumberingXml
    ? parseXml(hostNumberingXml, "word/numbering.xml").document
    : null;
  const hostRoot = hostDocument ? numberingRoot(hostDocument, "word/numbering.xml") : null;

  const usedAbstract = new Set<number>();
  const usedNum = new Set<number>();
  if (hostRoot) {
    const hostAbstract = collectById(hostRoot, "abstractNum", "abstractNumId", "word/numbering.xml");
    const hostNums = collectById(hostRoot, "num", "numId", "word/numbering.xml");
    validateAbstractReferences(hostNums, new Set(hostAbstract.keys()), "word/numbering.xml");
    for (const id of hostAbstract.keys()) usedAbstract.add(id);
    for (const id of hostNums.keys()) usedNum.add(id);
  }

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex];
    const context = `${source.fileName} word/numbering.xml`;
    const bodyReferences = collectBodyNumberReferences(
      source.document,
      `${source.fileName} word/document.xml`
    );

    if (!source.numberingXml) {
      if (bodyReferences.size > 0) {
        throw DocxErrors.unsupportedStructure(
          `"${source.fileName}" uses list numbering but has no numbering part.`,
          `${source.fileName}: numIds ${[...bodyReferences].join(", ")}`
        );
      }
      numIdMaps.push(new Map());
      continue;
    }

    const document = parseXml(source.numberingXml, context).document;
    const root = numberingRoot(document, context);
    rejectRelationshipDependentNumbering(root, context);

    const abstracts = collectById(root, "abstractNum", "abstractNumId", context);
    const nums = collectById(root, "num", "numId", context);
    validateAbstractReferences(nums, new Set(abstracts.keys()), context);

    for (const reference of bodyReferences) {
      if (!nums.has(reference)) {
        throw DocxErrors.unsupportedStructure(
          `"${source.fileName}" references a numbering definition that does not exist.`,
          `${source.fileName}: numId ${reference}`
        );
      }
    }

    if (!hostRoot || !hostDocument) {
      if (abstracts.size > 0 || nums.size > 0) {
        throw DocxErrors.unsupportedStructure(
          `"${source.fileName}" uses numbering, but the first document has no numbering part to merge into.`,
          `${source.fileName}: ${abstracts.size} abstract definitions, ${nums.size} list instances`
        );
      }
      numIdMaps.push(new Map());
      continue;
    }

    const abstractMap = new Map<number, number>();
    for (const oldId of abstracts.keys()) {
      const newId = nextId(usedAbstract, 0);
      usedAbstract.add(newId);
      abstractMap.set(oldId, newId);
    }

    const numMap = new Map<number, number>();
    for (const oldId of nums.keys()) {
      const newId = nextId(usedNum, 1);
      usedNum.add(newId);
      numMap.set(oldId, newId);
    }

    for (const [oldId, abstract] of abstracts) {
      const newId = abstractMap.get(oldId);
      if (newId === undefined) {
        throw DocxErrors.processingFailure("A numbering ID allocation was lost.");
      }
      const clone = hostDocument.importNode(abstract, true) as Element;
      setWordAttribute(clone, "abstractNumId", String(newId));
      rewriteNumberReferences(clone, numMap, context);
      insertAbstract(hostRoot, clone);
      importedAbstractNum[sourceIndex] += 1;
    }

    for (const [oldId, num] of nums) {
      const newId = numMap.get(oldId);
      const reference = directChildByLocalName(num, WORD_NAMESPACE, "abstractNumId");
      const oldAbstractId = reference
        ? parseNonNegativeInt(wordAttribute(reference, "val"))
        : null;
      const newAbstractId =
        oldAbstractId === null ? undefined : abstractMap.get(oldAbstractId);
      if (newId === undefined || newAbstractId === undefined) {
        throw DocxErrors.processingFailure("A numbering ID allocation was lost.");
      }

      const clone = hostDocument.importNode(num, true) as Element;
      setWordAttribute(clone, "numId", String(newId));
      const cloneReference = directChildByLocalName(clone, WORD_NAMESPACE, "abstractNumId");
      if (!cloneReference) {
        throw DocxErrors.unsupportedStructure(
          `${context} has a numbering instance with no abstract reference.`,
          `numId: ${oldId}`
        );
      }
      setWordAttribute(cloneReference, "val", String(newAbstractId));
      rewriteNumberReferences(clone, numMap, context);
      insertNum(hostRoot, clone);
      importedNum[sourceIndex] += 1;
    }

    numIdMaps.push(numMap);
  }

  const numberingDefinitions = hostRoot
    ? hostRoot.getElementsByTagNameNS(WORD_NAMESPACE, "abstractNum").length +
      hostRoot.getElementsByTagNameNS(WORD_NAMESPACE, "num").length
    : 0;

  const changed = importedNum.some((count) => count > 0) ||
    importedAbstractNum.some((count) => count > 0);
  if (!hostDocument || !changed) {
    return { numIdMaps, importedNum, importedAbstractNum, numberingDefinitions };
  }

  const xml = serializeXml(hostDocument);
  try {
    parseXml(xml, "word/numbering.xml (merged)");
  } catch (error) {
    throw DocxErrors.processingFailure(
      "The merged numbering table could not be serialised safely.",
      toDocxError(error).detail
    );
  }

  return { xml, numIdMaps, importedNum, importedAbstractNum, numberingDefinitions };
}
