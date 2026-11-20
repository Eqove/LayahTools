/**
 * Detection of content the merge engine cannot preserve.
 *
 * The first document is the host and is allowed to keep any package structure: we only append
 * content to its body, so its own headers, footnotes, custom XML and media remain intact.
 * Every later document must fit the supported subset: body content, styles, numbering, internal
 * image relationships, external hyperlink relationships and well-formed bookmarks. Anything else
 * is refused with UNSUPPORTED_STRUCTURE — content is never dropped and processing never continues.
 */

import { WORD_NAMESPACE } from "../constants";
import { DocxErrors, isDocxError, type DocxError } from "../errors";
import { parseXml } from "../xml";
import { analyzeBookmarks } from "./bookmarks";
import {
  OFFICE_RELATIONSHIPS_NAMESPACE,
  relationshipTypeSuffix,
} from "./package";
import {
  relationshipMap,
  reviewRelationshipReferences,
} from "./relationships";

const OFFICE_NAMESPACE = "urn:schemas-microsoft-com:office:office";

/**
 * Relationship types whose presence is already covered by a part check or a body check.
 * Anything outside this set is reported as an unknown relationship, which also fails closed.
 */
const KNOWN_RELATIONSHIP_TYPES = new Set([
  "styles",
  "numbering",
  "theme",
  "settings",
  "fontTable",
  "webSettings",
  "image",
  "hyperlink",
  "header",
  "footer",
  "footnotes",
  "endnotes",
  "comments",
  "chart",
  "diagram",
  "oleObject",
  "package",
  "customXml",
  "glossaryDocument",
  "aFChunk",
  "subDocument",
]);

interface PartRule {
  matches: (lowerPath: string) => boolean;
  feature: string;
}

const PART_RULES: readonly PartRule[] = [
  { matches: (path) => /^word\/header[^/]*\.xml$/.test(path), feature: "headers and footers" },
  { matches: (path) => /^word\/footer[^/]*\.xml$/.test(path), feature: "headers and footers" },
  { matches: (path) => path === "word/footnotes.xml", feature: "footnotes" },
  { matches: (path) => path === "word/endnotes.xml", feature: "endnotes" },
  { matches: (path) => /^word\/comments[^/]*\.xml$/.test(path), feature: "comments" },
  { matches: (path) => path.startsWith("word/charts/"), feature: "charts" },
  { matches: (path) => path.startsWith("word/diagrams/"), feature: "SmartArt diagrams" },
  { matches: (path) => path.startsWith("word/embeddings/"), feature: "embedded objects" },
  { matches: (path) => path.startsWith("word/fonts/"), feature: "embedded fonts" },
  { matches: (path) => path.startsWith("customxml/"), feature: "custom XML" },
  { matches: (path) => path.startsWith("word/glossary/"), feature: "glossary documents" },
  { matches: (path) => path.startsWith("_xmlsignatures/"), feature: "digital signatures" },
  { matches: (path) => path.startsWith("word/activex/"), feature: "ActiveX controls" },
];

/** Body elements that depend on a part or relationship the merge does not import. */
const ELEMENT_FEATURES: ReadonlyMap<string, string> = new Map([
  [`${WORD_NAMESPACE}|altChunk`, "altChunk content"],
  [`${WORD_NAMESPACE}|subDoc`, "subdocuments"],
  [`${WORD_NAMESPACE}|object`, "embedded OLE objects"],
  [`${OFFICE_NAMESPACE}|OLEObject`, "embedded OLE objects"],
  [`${WORD_NAMESPACE}|footnoteReference`, "footnote references"],
  [`${WORD_NAMESPACE}|endnoteReference`, "endnote references"],
  [`${WORD_NAMESPACE}|commentReference`, "comments"],
  [`${WORD_NAMESPACE}|commentRangeStart`, "comments"],
  [`${WORD_NAMESPACE}|commentRangeEnd`, "comments"],
  [`${WORD_NAMESPACE}|headerReference`, "header and footer references"],
  [`${WORD_NAMESPACE}|footerReference`, "header and footer references"],
  [`${WORD_NAMESPACE}|customXml`, "custom XML markup"],
  [`${WORD_NAMESPACE}|contentPart`, "content parts"],
  [`${WORD_NAMESPACE}|control`, "ActiveX controls"],
  [`${WORD_NAMESPACE}|movie`, "embedded movies"],
]);

const DRAWING_CHART_NAMESPACE_PREFIX = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DRAWING_DIAGRAM_NAMESPACE_PREFIX =
  "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const CHART_EX_NAMESPACE_PREFIX = "http://schemas.microsoft.com/office/drawing/2014/chartex";

const drawingFeature = (namespace: string | null): string | null => {
  if (!namespace) return null;
  if (namespace.startsWith(DRAWING_CHART_NAMESPACE_PREFIX) || namespace.startsWith(CHART_EX_NAMESPACE_PREFIX)) {
    return "charts";
  }
  if (namespace.startsWith(DRAWING_DIAGRAM_NAMESPACE_PREFIX)) {
    return "SmartArt diagrams";
  }
  return null;
};

export interface UnsupportedFinding {
  fileName: string;
  /** User-facing feature name, e.g. "footnotes" or "hyperlinks". */
  feature: string;
  /** Technical evidence: part paths or element/attribute names. */
  detail: string;
}

const MAX_DETAILS_PER_FEATURE = 4;

class FindingSet {
  private readonly byFeature = new Map<string, string[]>();

  add(feature: string, detail: string): void {
    const existing = this.byFeature.get(feature);
    if (existing) {
      if (existing.length < MAX_DETAILS_PER_FEATURE && !existing.includes(detail)) {
        existing.push(detail);
      }
      return;
    }
    this.byFeature.set(feature, [detail]);
  }

  toFindings(fileName: string): UnsupportedFinding[] {
    return [...this.byFeature.entries()].map(([feature, details]) => ({
      fileName,
      feature,
      detail: details.join(", "),
    }));
  }
}

/**
 * Inspects one non-host document. Returns every distinct unsupported feature found.
 * The caller turns these into warnings and a typed UNSUPPORTED_STRUCTURE failure.
 */
export function detectUnsupportedDocument(
  document: Document,
  entryNames: readonly string[],
  documentRelsXml: string | null,
  contentTypesXml: string | null,
  numberingXml: string | null,
  fileName: string
): UnsupportedFinding[] {
  const findings = new FindingSet();

  for (const entry of entryNames) {
    const lower = entry.toLowerCase();
    for (const rule of PART_RULES) {
      if (rule.matches(lower)) findings.add(rule.feature, entry);
    }
  }

  const elements = document.getElementsByTagName("*");
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const elementFeature =
      ELEMENT_FEATURES.get(`${element.namespaceURI ?? ""}|${element.localName ?? ""}`) ??
      drawingFeature(element.namespaceURI);
    if (elementFeature) findings.add(elementFeature, element.nodeName);
  }

  const relationships = relationshipMap(
    documentRelsXml,
    `${fileName} word/_rels/document.xml.rels`
  );
  for (const relationship of relationships.values()) {
    const suffix = relationshipTypeSuffix(relationship.type);
    if (!KNOWN_RELATIONSHIP_TYPES.has(suffix)) {
      findings.add("unsupported relationship types", `${suffix} -> ${relationship.target}`);
    }
  }
  for (const issue of reviewRelationshipReferences(document, relationships, {
    fileName,
    entryNames,
    contentTypesXml,
  })) {
    findings.add(issue.feature, issue.detail);
  }

  try {
    analyzeBookmarks(document, fileName);
  } catch (error) {
    if (isDocxError(error) && error.code === "UNSUPPORTED_STRUCTURE") {
      findings.add("malformed bookmarks", error.detail ?? error.message);
    } else {
      throw error;
    }
  }

  if (numberingXml) {
    const numberingDocument = parseXml(numberingXml, `${fileName} word/numbering.xml`).document;
    const root = numberingDocument.documentElement;
    if (root.getElementsByTagNameNS(WORD_NAMESPACE, "numPicBullet").length > 0) {
      findings.add("picture bullets", "w:numPicBullet");
    }
    if (root.getElementsByTagNameNS(WORD_NAMESPACE, "lvlPicBulletId").length > 0) {
      findings.add("picture bullets", "w:lvlPicBulletId");
    }

    const numberingElements = root.getElementsByTagName("*");
    for (let index = 0; index < numberingElements.length; index++) {
      const element = numberingElements[index];
      for (let attributeIndex = 0; attributeIndex < element.attributes.length; attributeIndex++) {
        const attribute = element.attributes.item(attributeIndex);
        if (attribute?.namespaceURI === OFFICE_RELATIONSHIPS_NAMESPACE) {
          findings.add("relationship-dependent numbering", `${element.nodeName}@${attribute.name}`);
        }
      }
    }
  }

  return findings.toFindings(fileName);
}

/** Aggregates findings into one typed failure. Callers add the warnings separately. */
export function unsupportedMergeError(findings: readonly UnsupportedFinding[]): DocxError {
  const detail = findings
    .map((finding) => `${finding.fileName}: ${finding.feature} (${finding.detail})`)
    .join("; ");
  return DocxErrors.unsupportedStructure(
    "One of the selected documents contains content this merge cannot preserve, so nothing was merged.",
    detail
  );
}
