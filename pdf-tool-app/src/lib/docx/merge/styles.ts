/**
 * Style-table reconciliation.
 *
 * First document wins. Missing definitions are imported verbatim from later documents, identical
 * definitions are skipped, and a same-ID different-definition conflict is skipped with a
 * MERGE_STYLE_CONFLICT warning. Style IDs are never renamed or duplicated, so references in the
 * imported body content keep pointing at a real, single definition.
 */

import { WORD_NAMESPACE } from "../constants";
import { DocxErrors, toDocxError } from "../errors";
import type { DocxWarning } from "../types";
import { parseXml, serializeXml } from "../xml";
import {
  XMLNS_NAMESPACE,
  directChildByLocalName,
  directChildrenByLocalName,
  wordAttribute,
} from "./package";

export interface StyleSource {
  fileName: string;
  stylesXml: string | null;
}

export interface StyleMergeResult {
  /** Rewritten styles.xml, present only when at least one style was imported. */
  xml?: string;
  /** Styles imported per non-host source, in source order. */
  imported: number[];
  /** Number of `w:style` definitions in the merged part. */
  styleCount: number;
  /** Union of every style ID defined by any input, used by verification to ignore built-ins. */
  sourceStyleIds: Set<string>;
}

function stylesRoot(document: Document, context: string): Element {
  const root = document.documentElement;
  if (root.localName !== "styles" || root.namespaceURI !== WORD_NAMESPACE) {
    throw DocxErrors.unsupportedStructure(
      `${context} is not a WordprocessingML styles part.`,
      `root: ${root.nodeName} (${root.namespaceURI ?? "no namespace"})`
    );
  }
  return root;
}

function collectStyles(root: Element, context: string): Map<string, Element> {
  const styles = new Map<string, Element>();
  for (const style of directChildrenByLocalName(root, WORD_NAMESPACE, "style")) {
    const styleId = wordAttribute(style, "styleId");
    if (!styleId) {
      throw DocxErrors.unsupportedStructure(
        `${context} contains a style without a styleId.`,
        `element: ${style.nodeName}`
      );
    }
    if (styles.has(styleId)) {
      throw DocxErrors.unsupportedStructure(
        `${context} defines the same style more than once.`,
        `styleId: ${styleId}`
      );
    }
    styles.set(styleId, style);
  }
  return styles;
}

/**
 * Canonical structural form of a node, used for semantic equality.
 *
 * Namespace declarations are ignored because the same definition can be serialised with the
 * declaration on the root in one document and locally in another. Attributes are sorted because
 * XML attribute order is not semantic. Text is only compared when it is non-whitespace.
 */
function canonicalNode(node: Node): string {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? "";
    return text.trim().length > 0 ? `#text:${text}` : "";
  }
  if (node.nodeType !== 1) return "";

  const element = node as Element;
  const attributes: string[] = [];
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    if (!attribute || attribute.namespaceURI === XMLNS_NAMESPACE) continue;
    attributes.push(
      `${attribute.namespaceURI ?? ""}|${attribute.localName ?? attribute.name}=${attribute.value}`
    );
  }
  attributes.sort();

  const children: string[] = [];
  for (let index = 0; index < element.childNodes.length; index++) {
    const child = canonicalNode(element.childNodes[index]);
    if (child) children.push(child);
  }

  const name = `${element.namespaceURI ?? ""}|${element.localName ?? element.nodeName}`;
  return `<${name} ${attributes.join(" ")}>${children.join("")}</${name}>`;
}

const elementsEquivalent = (a: Element, b: Element): boolean => canonicalNode(a) === canonicalNode(b);

function conflictWarning(fileName: string, styleId: string): DocxWarning {
  return {
    code: "MERGE_STYLE_CONFLICT",
    message: `"${fileName}" defines a different "${styleId}" style. The first document's definition is used.`,
    detail: `${fileName}: ${styleId}`,
  };
}

/**
 * Merges non-host style tables into the host's.
 *
 * `w:docDefaults` and `w:latentStyles` are host-only. A differing non-host docDefaults is
 * reported rather than imported, because importing it would silently change host formatting.
 */
export function mergeStyles(
  hostStylesXml: string | null,
  sources: readonly StyleSource[],
  warnings: DocxWarning[]
): StyleMergeResult {
  const imported = sources.map(() => 0);
  const sourceStyleIds = new Set<string>();

  if (hostStylesXml === null) {
    // Nothing to merge into. If a later document defines styles at all, the merge cannot preserve
    // them without creating a new package part and relationship, which phase 9.1 does not do.
    for (const source of sources) {
      if (!source.stylesXml) continue;
      const document = parseXml(source.stylesXml, `${source.fileName} word/styles.xml`).document;
      const root = stylesRoot(document, `${source.fileName} word/styles.xml`);
      const styles = collectStyles(root, `${source.fileName} word/styles.xml`);
      for (const styleId of styles.keys()) sourceStyleIds.add(styleId);
      if (styles.size > 0) {
        throw DocxErrors.unsupportedStructure(
          `"${source.fileName}" defines styles, but the first document has no styles part to merge them into.`,
          `${source.fileName}: ${styles.size} style definitions`
        );
      }
    }
    return { imported, styleCount: 0, sourceStyleIds };
  }

  const hostDocument = parseXml(hostStylesXml, "word/styles.xml").document;
  const hostRoot = stylesRoot(hostDocument, "word/styles.xml");
  const hostStyles = collectStyles(hostRoot, "word/styles.xml");
  for (const styleId of hostStyles.keys()) sourceStyleIds.add(styleId);

  const hostDocDefaults = directChildByLocalName(hostRoot, WORD_NAMESPACE, "docDefaults");

  let changed = false;
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex];
    if (!source.stylesXml) continue;

    const document = parseXml(source.stylesXml, `${source.fileName} word/styles.xml`).document;
    const root = stylesRoot(document, `${source.fileName} word/styles.xml`);
    const styles = collectStyles(root, `${source.fileName} word/styles.xml`);

    for (const [styleId, style] of styles) {
      sourceStyleIds.add(styleId);
      const hostStyle = hostStyles.get(styleId);
      if (hostStyle) {
        if (!elementsEquivalent(hostStyle, style)) {
          warnings.push(conflictWarning(source.fileName, styleId));
        }
        continue;
      }

      const clone = hostDocument.importNode(style, true) as Element;
      hostRoot.appendChild(clone);
      hostStyles.set(styleId, clone);
      imported[sourceIndex] += 1;
      changed = true;
    }

    const sourceDocDefaults = directChildByLocalName(root, WORD_NAMESPACE, "docDefaults");
    if (sourceDocDefaults) {
      const differs =
        !hostDocDefaults || !elementsEquivalent(hostDocDefaults, sourceDocDefaults);
      if (differs) {
        warnings.push({
          code: "MERGE_STYLE_CONFLICT",
          message: `"${source.fileName}" has different document default formatting. The first document's defaults are used.`,
          detail: `${source.fileName}: docDefaults`,
        });
      }
    }
  }

  if (!changed) {
    return { imported, styleCount: hostStyles.size, sourceStyleIds };
  }

  const xml = serializeXml(hostDocument);
  try {
    parseXml(xml, "word/styles.xml (merged)");
  } catch (error) {
    throw DocxErrors.processingFailure(
      "The merged style table could not be serialised safely.",
      toDocxError(error).detail
    );
  }

  return { xml, imported, styleCount: hostStyles.size, sourceStyleIds };
}
