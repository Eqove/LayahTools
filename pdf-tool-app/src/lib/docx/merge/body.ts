/**
 * Body splicing.
 *
 * The first document's body is the base. Every later document's block-level content is imported
 * in order and appended. Section properties follow the OOXML rule that a paragraph-level sectPr
 * ends the section containing the preceding content, while the body-level sectPr ends the final
 * section. So every source's final sectPr becomes an inline section-break paragraph except the
 * last source that has one, which supplies the output's body-level sectPr.
 */

import { WORD_NAMESPACE } from "../constants";
import { DocxErrors, toDocxError } from "../errors";
import { parseXml, serializeXml } from "../xml";
import type { BookmarkPlan } from "./bookmarks";
import { rewriteBookmarks } from "./bookmarks";
import {
  XMLNS_NAMESPACE,
  directChildrenByLocalName,
  elementChildren,
  parseNonNegativeInt,
  setWordAttribute,
  wordAttribute,
} from "./package";
import { rewriteRelationshipReferences } from "./relationships";

const MC_NAMESPACE = "http://schemas.openxmlformats.org/markup-compatibility/2006";

export interface BodyMergeSource {
  fileName: string;
  document: Document;
  /** Empty for the host; old numId -> new numId for imported content. */
  numberIdMap: ReadonlyMap<number, number>;
  /** Empty for the host; old document relationship ID -> new host ID. */
  relationshipIdMap: ReadonlyMap<string, string>;
  /** Undefined for the host. */
  bookmarkPlan?: BookmarkPlan;
  /** Final merged-document bookmark names, enforced while rewriting anchors. */
  allowedBookmarkNames: ReadonlySet<string>;
}

export interface BodyMergeSourceResult {
  paragraphCount: number;
  tableCount: number;
  sectionBreaks: number;
}

export interface BodyMergeResult {
  /** Serialised merged document.xml, present only for a multi-document merge. */
  xml?: string;
  paragraphCount: number;
  tableCount: number;
  sectionBreaks: number;
  perSource: BodyMergeSourceResult[];
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function countParagraphs(scope: Document | Element): number {
  return scope.getElementsByTagNameNS(WORD_NAMESPACE, "p").length;
}

export function countTables(scope: Document | Element): number {
  return scope.getElementsByTagNameNS(WORD_NAMESPACE, "tbl").length;
}

/**
 * Text from `<w:t>` runs, paragraph by paragraph, in document order.
 * Nested table paragraphs are included. Formatting-only elements are ignored.
 */
export function collectBodyText(document: Document): string {
  const bodies = document.getElementsByTagNameNS(WORD_NAMESPACE, "body");
  if (bodies.length === 0) return "";
  const body = bodies[0];
  const paragraphs = body.getElementsByTagNameNS(WORD_NAMESPACE, "p");
  const parts: string[] = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const texts = paragraphs[paragraphIndex].getElementsByTagNameNS(WORD_NAMESPACE, "t");
    let text = "";
    for (let textIndex = 0; textIndex < texts.length; textIndex++) {
      text += texts[textIndex].textContent ?? "";
    }
    parts.push(text);
  }
  return parts.join("\n");
}

function requireBody(document: Document, fileName: string): Element {
  const bodies = document.getElementsByTagNameNS(WORD_NAMESPACE, "body");
  if (bodies.length === 0) {
    throw DocxErrors.unsupportedStructure(
      `"${fileName}" has no document body.`,
      "word/document.xml"
    );
  }
  return bodies[0];
}

function directSectPr(body: Element, fileName: string): Element | undefined {
  const matches = directChildrenByLocalName(body, WORD_NAMESPACE, "sectPr");
  if (matches.length > 1) {
    throw DocxErrors.unsupportedStructure(
      `"${fileName}" has more than one body-level section definition.`,
      `w:sectPr x${matches.length}`
    );
  }
  return matches[0];
}

interface PreparedSource {
  source: BodyMergeSource;
  body: Element;
  sectPr?: Element;
  content: Element[];
  paragraphCount: number;
  tableCount: number;
}

/** Copies missing namespace declarations onto the host root and unions mc:Ignorable. */
function mergeNamespaces(hostDocument: Document, sources: readonly Document[]): void {
  const hostRoot = hostDocument.documentElement;
  const ignorable: string[] = [];
  const seen = new Set<string>();

  const addTokens = (value: string | null): void => {
    if (!value) return;
    for (const token of value.split(/\s+/)) {
      if (token && !seen.has(token)) {
        seen.add(token);
        ignorable.push(token);
      }
    }
  };

  addTokens(hostRoot.getAttributeNS(MC_NAMESPACE, "Ignorable"));

  for (const document of sources) {
    const root = document.documentElement;
    for (let index = 0; index < root.attributes.length; index++) {
      const attribute = root.attributes.item(index);
      if (!attribute) continue;
      if (
        attribute.namespaceURI === XMLNS_NAMESPACE &&
        attribute.name !== "xmlns" &&
        attribute.name.startsWith("xmlns:") &&
        !hostRoot.hasAttribute(attribute.name)
      ) {
        hostRoot.setAttributeNS(XMLNS_NAMESPACE, attribute.name, attribute.value);
      }
    }
    addTokens(root.getAttributeNS(MC_NAMESPACE, "Ignorable"));
  }

  if (ignorable.length > 0) {
    if (!hostRoot.hasAttribute("xmlns:mc")) {
      hostRoot.setAttributeNS(XMLNS_NAMESPACE, "xmlns:mc", MC_NAMESPACE);
    }
    // A token whose prefix is not declared on the merged root would be an invalid
    // mc:Ignorable entry. Source root declarations were copied above, so this only drops
    // genuinely unresolvable prefixes.
    const declared = ignorable.filter(
      (token) => token === "xml" || hostRoot.hasAttribute(`xmlns:${token}`)
    );
    if (declared.length > 0) {
      hostRoot.setAttributeNS(MC_NAMESPACE, "mc:Ignorable", declared.join(" "));
    }
  }
}

function createSectionBreakParagraph(hostDocument: Document, sectPr: Element): Element {
  if (sectPr.parentNode) sectPr.parentNode.removeChild(sectPr);

  const paragraph = hostDocument.createElementNS(WORD_NAMESPACE, "w:p");
  const properties = hostDocument.createElementNS(WORD_NAMESPACE, "w:pPr");
  paragraph.appendChild(properties);
  properties.appendChild(sectPr);
  return paragraph;
}

function rewriteBodyNumbering(
  element: Element,
  map: ReadonlyMap<number, number>,
  fileName: string
): void {
  if (map.size === 0) return;

  const references = element.getElementsByTagNameNS(WORD_NAMESPACE, "numId");
  for (let index = 0; index < references.length; index++) {
    const reference = references[index];
    const value = parseNonNegativeInt(wordAttribute(reference, "val"));
    if (value === null) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" contains a numbering reference with a missing or invalid value.`,
        `w:numId value: ${wordAttribute(reference, "val") ?? "(missing)"}`
      );
    }
    if (value === 0) continue;
    const mapped = map.get(value);
    if (mapped === undefined) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" references a numbering definition that does not exist.`,
        `numId: ${value}`
      );
    }
    setWordAttribute(reference, "val", String(mapped));
  }
}

/** Applies every reconciliation step to one imported subtree. */
function rewriteImportedElement(
  imported: Element,
  source: BodyMergeSource,
  allowedBookmarkNames: ReadonlySet<string>
): void {
  rewriteBodyNumbering(imported, source.numberIdMap, source.fileName);
  rewriteRelationshipReferences(imported, source.relationshipIdMap, source.fileName);
  if (source.bookmarkPlan) {
    rewriteBookmarks(imported, source.bookmarkPlan, allowedBookmarkNames, source.fileName);
  }
}

/**
 * Splices every source body into the host body.
 *
 * The host document is mutated in place; the caller owns that parsed DOM and never the uploaded
 * bytes. A single-source merge is a pass-through: no XML is rewritten and `xml` is undefined.
 */
export function mergeDocumentBodies(sources: readonly BodyMergeSource[]): BodyMergeResult {
  if (sources.length === 0) {
    throw DocxErrors.emptyDocument("Select at least one document to merge.");
  }

  const hostDocument = sources[0].document;
  const hostBody = requireBody(hostDocument, sources[0].fileName);

  const prepared: PreparedSource[] = sources.map((source) => {
    const body = requireBody(source.document, source.fileName);
    const sectPr = directSectPr(body, source.fileName);
    const content = elementChildren(body).filter((element) => element !== sectPr);
    return {
      source,
      body,
      sectPr,
      content,
      paragraphCount: countParagraphs(body),
      tableCount: countTables(body),
    };
  });

  const perSource: BodyMergeSourceResult[] = prepared.map((source) => ({
    paragraphCount: source.paragraphCount,
    tableCount: source.tableCount,
    sectionBreaks: 0,
  }));

  if (sources.length === 1) {
    return {
      paragraphCount: perSource[0].paragraphCount,
      tableCount: perSource[0].tableCount,
      sectionBreaks: 0,
      perSource,
    };
  }

  let finalIndex = -1;
  for (let index = prepared.length - 1; index >= 0; index--) {
    if (prepared[index].sectPr) {
      finalIndex = index;
      break;
    }
  }

  mergeNamespaces(
    hostDocument,
    prepared.map((source) => source.source.document)
  );

  const hostSectPr = prepared[0].sectPr;
  if (hostSectPr && hostSectPr.parentNode === hostBody) {
    hostBody.removeChild(hostSectPr);
  }

  let sectionBreaks = 0;
  if (hostSectPr && finalIndex !== 0) {
    hostBody.appendChild(createSectionBreakParagraph(hostDocument, hostSectPr));
    sectionBreaks++;
    perSource[0].sectionBreaks++;
  }

  let finalSectPr: Element | undefined = finalIndex === 0 ? hostSectPr : undefined;

  for (let index = 1; index < prepared.length; index++) {
    const current = prepared[index];

    for (const node of current.content) {
      const imported = hostDocument.importNode(node, true) as Element;
      rewriteImportedElement(
        imported,
        current.source,
        current.source.allowedBookmarkNames
      );
      hostBody.appendChild(imported);
    }

    if (current.sectPr) {
      const imported = hostDocument.importNode(current.sectPr, true) as Element;
      rewriteImportedElement(
        imported,
        current.source,
        current.source.allowedBookmarkNames
      );
      if (index === finalIndex) {
        finalSectPr = imported;
      } else {
        hostBody.appendChild(createSectionBreakParagraph(hostDocument, imported));
        sectionBreaks++;
        perSource[index].sectionBreaks++;
      }
    }
  }

  if (finalSectPr) hostBody.appendChild(finalSectPr);

  const xml = serializeXml(hostDocument);
  try {
    parseXml(xml, "word/document.xml (merged)");
  } catch (error) {
    throw DocxErrors.processingFailure(
      "The merged document body could not be serialised safely.",
      toDocxError(error).detail
    );
  }

  return {
    xml,
    paragraphCount: countParagraphs(hostBody),
    tableCount: countTables(hostBody),
    sectionBreaks,
    perSource,
  };
}
