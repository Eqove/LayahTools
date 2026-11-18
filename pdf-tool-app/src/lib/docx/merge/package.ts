/**
 * Package-level helpers shared by the merge modules: part reads, DOM traversal, relationship
 * parsing, target resolution and the content-types manifest.
 *
 * Nothing here writes to a package. The merge pipeline mutates its own in-memory JSZip instance
 * only after every input has been validated.
 */

import {
  CONTENT_TYPES_NAMESPACE,
  WORD_NAMESPACE,
} from "../constants";
import { DocxErrors } from "../errors";
import type { DocxLimits, DocxPackage } from "../types";
import { parseXml } from "../xml";
import { readDocxEntryText } from "../zip";

export const RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export const OFFICE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** Reads a part when present, or returns null. Oversized/corrupt parts still fail loudly. */
export async function readOptionalPartText(
  pkg: DocxPackage,
  path: string,
  limits: DocxLimits
): Promise<string | null> {
  if (!pkg.zip.file(path)) return null;
  return readDocxEntryText(pkg, path, limits);
}

export const isElement = (node: Node): node is Element => node.nodeType === 1;

/** Direct element children in document order. */
export function elementChildren(node: Node): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index++) {
    const child = node.childNodes[index];
    if (isElement(child)) children.push(child);
  }
  return children;
}

export function directChildrenByLocalName(
  parent: Element,
  namespace: string,
  localName: string
): Element[] {
  return elementChildren(parent).filter(
    (child) => child.namespaceURI === namespace && child.localName === localName
  );
}

export function directChildByLocalName(
  parent: Element,
  namespace: string,
  localName: string
): Element | undefined {
  return elementChildren(parent).find(
    (child) => child.namespaceURI === namespace && child.localName === localName
  );
}

/** Reads a WordprocessingML attribute by local name, or null when absent. */
export function wordAttribute(element: Element, localName: string): string | null {
  const node = element.getAttributeNodeNS(WORD_NAMESPACE, localName);
  return node ? node.value : null;
}

export function setWordAttribute(element: Element, localName: string, value: string): void {
  element.setAttributeNS(WORD_NAMESPACE, `w:${localName}`, value);
}

/** Parses a non-negative integer attribute. Returns null for missing or malformed values. */
export function parseNonNegativeInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export interface PackageRelationship {
  id: string;
  type: string;
  target: string;
  targetMode: string | null;
}

/** Parses an OPC `.rels` part and rejects a root element that is not a Relationships manifest. */
export function parseRelationships(xml: string, context: string): PackageRelationship[] {
  const document = parseXml(xml, context).document;
  const root = document.documentElement;
  if (root.localName !== "Relationships" || root.namespaceURI !== RELATIONSHIPS_NAMESPACE) {
    throw DocxErrors.unsupportedStructure(
      `${context} is not a valid relationships part.`,
      `root: ${root.nodeName} (${root.namespaceURI ?? "no namespace"})`
    );
  }

  const relationships: PackageRelationship[] = [];
  for (const element of elementChildren(root)) {
    if (element.localName !== "Relationship" || element.namespaceURI !== RELATIONSHIPS_NAMESPACE) {
      continue;
    }
    const id = element.getAttribute("Id");
    const type = element.getAttribute("Type");
    const target = element.getAttribute("Target");
    if (!id || !type || !target) {
      throw DocxErrors.unsupportedStructure(
        `${context} contains an incomplete relationship.`,
        `Id: ${id || "(missing)"}, Type: ${type || "(missing)"}, Target: ${target || "(missing)"}`
      );
    }
    const targetMode = element.getAttribute("TargetMode");
    relationships.push({
      id,
      type,
      target,
      targetMode: targetMode ? targetMode : null,
    });
  }
  return relationships;
}

/** OPC relationship types are URIs; the last path segment is the useful, stable identifier. */
export const relationshipTypeSuffix = (type: string): string => {
  const slash = type.lastIndexOf("/");
  return slash === -1 ? type : type.slice(slash + 1);
};

/**
 * Resolves a relationship target against the part that owns the `.rels` file.
 * Handles leading `/`, `./`, `../`, and a trailing fragment.
 */
export function resolvePartTarget(ownerPartPath: string, target: string): string | null {
  const withoutFragment = target.split("#")[0];
  if (withoutFragment.length === 0) return null;

  const segments = withoutFragment.startsWith("/")
    ? []
    : ownerPartPath.split("/").slice(0, -1);

  for (const segment of withoutFragment.replace(/^\/+/, "").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join("/") : null;
}

export interface ContentTypeManifest {
  /** Extension (lower-case) to content type. */
  defaults: Map<string, string>;
  /** Part path without a leading slash to content type. */
  overrides: Map<string, string>;
}

export function parseContentTypes(xml: string): ContentTypeManifest {
  const document = parseXml(xml, "[Content_Types].xml").document;
  const root = document.documentElement;
  if (root.localName !== "Types" || root.namespaceURI !== CONTENT_TYPES_NAMESPACE) {
    throw DocxErrors.unsupportedStructure(
      "The document's content-types manifest is not the expected kind of file.",
      `root: ${root.nodeName} (${root.namespaceURI ?? "no namespace"})`
    );
  }

  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const element of elementChildren(root)) {
    if (element.namespaceURI !== CONTENT_TYPES_NAMESPACE) continue;
    if (element.localName === "Default") {
      const extension = element.getAttribute("Extension");
      const contentType = element.getAttribute("ContentType");
      if (extension && contentType) defaults.set(extension.toLowerCase(), contentType);
    } else if (element.localName === "Override") {
      const partName = element.getAttribute("PartName");
      const contentType = element.getAttribute("ContentType");
      if (partName && contentType) {
        overrides.set(partName.replace(/^\/+/, ""), contentType);
      }
    }
  }
  return { defaults, overrides };
}

/** True when a ZIP entry is covered by an Override or by a Default for its extension. */
export function isPartTyped(manifest: ContentTypeManifest, partPath: string): boolean {
  if (manifest.overrides.has(partPath)) return true;
  const dot = partPath.lastIndexOf(".");
  if (dot === -1) return false;
  return manifest.defaults.has(partPath.slice(dot + 1).toLowerCase());
}

/**
 * The content type an OPC manifest declares for a part: an Override wins, otherwise the
 * extension Default applies. Returns null when the part is untyped.
 */
export function declaredContentType(
  manifest: ContentTypeManifest,
  partPath: string
): string | null {
  const override = manifest.overrides.get(partPath);
  if (override) return override;
  const dot = partPath.lastIndexOf(".");
  if (dot === -1) return null;
  return manifest.defaults.get(partPath.slice(dot + 1).toLowerCase()) ?? null;
}
