/**
 * Relationship-aware importing for phase 9.2.
 *
 * Relationship IDs are scoped to the `.rels` part that owns them. Imported body content always
 * comes from a source's `word/document.xml`, so its references are resolved against that source's
 * `word/_rels/document.xml.rels` and re-created in the host's document relationship scope.
 *
 * Only two relationship families are imported into the body:
 * - `image` relationships with an internal target: the media bytes are copied and the reference
 *   is rewritten to a newly allocated destination relationship.
 * - `hyperlink` relationships with `TargetMode="External"`: the exact target URL is preserved and
 *   a new external relationship is created.
 *
 * Everything else stays outside the supported subset and is rejected by `unsupported.ts`.
 */

import {
  CONTENT_TYPES_NAMESPACE,
  CONTENT_TYPES_PATH,
  DOCUMENT_PATH,
} from "../constants";
import { DocxErrors } from "../errors";
import type { DocxLimits, DocxPackage } from "../types";
import { parseXml, serializeXml } from "../xml";
import { readDocxEntry } from "../zip";
import {
  OFFICE_RELATIONSHIPS_NAMESPACE,
  RELATIONSHIPS_NAMESPACE,
  type ContentTypeManifest,
  type PackageRelationship,
  declaredContentType,
  elementChildren,
  parseContentTypes,
  parseRelationships,
  relationshipTypeSuffix,
  resolvePartTarget,
} from "./package";

export const RELATIONSHIPS_CONTENT_TYPE =
  "application/vnd.openxmlformats-package.relationships+xml";

/** One relationship-namespace attribute found in imported body content. */
export interface RelationshipReference {
  element: Element;
  attribute: Attr;
  id: string;
}

export interface RelationshipIssue {
  feature: string;
  detail: string;
}

/** Every `r:*` attribute in a subtree, in document order. */
export function collectRelationshipReferences(root: Document | Element): RelationshipReference[] {
  const references: RelationshipReference[] = [];
  const elements = root.getElementsByTagName("*");
  const visit = (element: Element): void => {
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      if (attribute.namespaceURI === OFFICE_RELATIONSHIPS_NAMESPACE) {
        references.push({ element, attribute, id: attribute.value });
      }
    }
  };

  if (root.nodeType === 1) visit(root as Element);
  for (let index = 0; index < elements.length; index++) visit(elements[index]);
  return references;
}

/** Parses a `.rels` part and rejects duplicate IDs, which would make resolution ambiguous. */
export function relationshipMap(
  relsXml: string | null,
  context: string
): Map<string, PackageRelationship> {
  const map = new Map<string, PackageRelationship>();
  if (!relsXml) return map;

  for (const relationship of parseRelationships(relsXml, context)) {
    if (map.has(relationship.id)) {
      throw DocxErrors.unsupportedStructure(
        `${context} defines relationship ${relationship.id} more than once.`,
        `duplicate relationship ID: ${relationship.id}`
      );
    }
    map.set(relationship.id, relationship);
  }
  return map;
}

export interface RelationshipReviewContext {
  fileName: string;
  entryNames: readonly string[];
  contentTypesXml: string | null;
}

const isExternal = (relationship: PackageRelationship): boolean =>
  relationship.targetMode === "External";

const mediaContentType = (
  context: RelationshipReviewContext,
  partPath: string,
  manifest: ContentTypeManifest | null
): string | null => {
  if (!manifest) return null;
  return declaredContentType(manifest, partPath);
};

/**
 * Reviews every body relationship reference without importing anything.
 * Used by unsupported-content detection so a malformed reference fails before any package work.
 */
export function reviewRelationshipReferences(
  document: Document,
  relationships: ReadonlyMap<string, PackageRelationship>,
  context: RelationshipReviewContext
): RelationshipIssue[] {
  const issues: RelationshipIssue[] = [];
  const entries = new Set(context.entryNames);
  let manifest: ContentTypeManifest | null = null;
  let manifestParsed = false;

  const parseManifest = (): ContentTypeManifest | null => {
    if (manifestParsed) return manifest;
    manifestParsed = true;
    if (context.contentTypesXml) {
      manifest = parseContentTypes(context.contentTypesXml);
    }
    return manifest;
  };

  for (const reference of collectRelationshipReferences(document)) {
    const relationship = relationships.get(reference.id);
    const label = `${reference.element.nodeName}@${reference.attribute.name}=${reference.id}`;
    if (!relationship) {
      issues.push({ feature: "unresolved relationship references", detail: label });
      continue;
    }

    const suffix = relationshipTypeSuffix(relationship.type);
    if (suffix === "image") {
      if (isExternal(relationship)) {
        issues.push({
          feature: "external image references",
          detail: `${label} -> ${relationship.target}`,
        });
        continue;
      }
      const target = resolvePartTarget(DOCUMENT_PATH, relationship.target);
      if (!target || !entries.has(target)) {
        issues.push({
          feature: "image parts missing from the package",
          detail: `${label} -> ${relationship.target}`,
        });
        continue;
      }
      const contentType = mediaContentType(context, target, parseManifest());
      if (!contentType || !/^image\//i.test(contentType)) {
        issues.push({
          feature: "image content types",
          detail: `${target}: ${contentType ?? "(no content type)"}`,
        });
      }
      continue;
    }

    if (suffix === "hyperlink") {
      if (!isExternal(relationship)) {
        issues.push({
          feature: "internal hyperlink relationships",
          detail: `${label} -> ${relationship.target}`,
        });
      }
      continue;
    }

    issues.push({
      feature: "unsupported relationship types",
      detail: `${suffix} -> ${relationship.target}`,
    });
  }

  return issues;
}

/** Rewrites every `r:*` attribute in an imported subtree through a resolved ID map. */
export function rewriteRelationshipReferences(
  root: Element,
  idMap: ReadonlyMap<string, string>,
  fileName: string
): void {
  for (const reference of collectRelationshipReferences(root)) {
    const mapped = idMap.get(reference.id);
    if (mapped === undefined) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" references a relationship that could not be imported safely.`,
        `${reference.element.nodeName}@${reference.attribute.name}: ${reference.id}`
      );
    }
    reference.element.setAttributeNS(
      OFFICE_RELATIONSHIPS_NAMESPACE,
      reference.attribute.name,
      mapped
    );
  }
}

export interface SourceRelationshipInput {
  fileName: string;
  document: Document;
  pkg: DocxPackage;
  relsXml: string | null;
  contentTypesXml: string | null;
}

export interface SourceRelationshipResult {
  /** Old document-scope relationship ID -> new host document-scope ID. */
  idMap: Map<string, string>;
  /** Distinct media parts newly copied for this source. */
  mediaImported: number;
  hyperlinksImported: number;
}

const RELATIONSHIPS_PART_PATH = "word/_rels/document.xml.rels";
const MEDIA_PREFIX = "word/media/";

const escapeCase = (value: string): string => value.toLowerCase();

/**
 * Owns the host relationship part and the host content-types part while sources are imported.
 * It mutates only the in-memory package it was constructed with; nothing is saved unless the
 * caller later writes the package.
 */
export class RelationshipImporter {
  private readonly limits: DocxLimits;
  private readonly hostPkg: DocxPackage;
  private readonly usedPartPaths = new Set<string>();
  private readonly usedRelationshipIds = new Set<string>();
  private readonly importedMediaPaths = new Set<string>();
  private readonly importedHyperlinkTargets: string[] = [];
  private readonly importedBytesByPath = new Map<string, number>();

  private relsDocument: Document | null;
  private relsRoot: Element | null;
  private relsChanged = false;
  private nextRelationshipNumber = 1;

  private readonly contentTypesDocument: Document;
  private readonly contentTypesRoot: Element;
  private contentTypesChanged = false;

  constructor(
    hostPkg: DocxPackage,
    hostRelsXml: string | null,
    hostContentTypesXml: string,
    limits: DocxLimits
  ) {
    this.hostPkg = hostPkg;
    this.limits = limits;
    for (const entry of hostPkg.info.entryNames) this.usedPartPaths.add(escapeCase(entry));

    if (hostRelsXml) {
      const parsed = parseXml(hostRelsXml, `${RELATIONSHIPS_PART_PATH} (host)`).document;
      const root = parsed.documentElement;
      if (root.localName !== "Relationships" || root.namespaceURI !== RELATIONSHIPS_NAMESPACE) {
        throw DocxErrors.unsupportedStructure(
          "The host document's relationship part is not a valid relationships manifest.",
          `root: ${root.nodeName} (${root.namespaceURI ?? "no namespace"})`
        );
      }
      this.relsDocument = parsed;
      this.relsRoot = root;
      for (const element of elementChildren(root)) {
        if (element.localName !== "Relationship") continue;
        const id = element.getAttribute("Id");
        if (!id) continue;
        this.usedRelationshipIds.add(id);
        const numeric = /^rId(\d+)$/.exec(id);
        if (numeric) {
          const value = Number(numeric[1]);
          if (Number.isSafeInteger(value) && value >= this.nextRelationshipNumber) {
            this.nextRelationshipNumber = value + 1;
          }
        }
      }
    } else {
      this.relsDocument = null;
      this.relsRoot = null;
    }

    const contentTypes = parseXml(hostContentTypesXml, CONTENT_TYPES_PATH).document;
    const contentTypesRoot = contentTypes.documentElement;
    if (
      contentTypesRoot.localName !== "Types" ||
      contentTypesRoot.namespaceURI !== CONTENT_TYPES_NAMESPACE
    ) {
      throw DocxErrors.unsupportedStructure(
        "The host document's content-types manifest is not the expected kind of file.",
        `root: ${contentTypesRoot.nodeName}`
      );
    }
    this.contentTypesDocument = contentTypes;
    this.contentTypesRoot = contentTypesRoot;
  }

  get importedMedia(): readonly string[] {
    return [...this.importedMediaPaths];
  }

  get importedHyperlinks(): readonly string[] {
    return [...this.importedHyperlinkTargets];
  }

  get importedBytes(): number {
    let total = 0;
    for (const value of this.importedBytesByPath.values()) total += value;
    return total;
  }

  /** Serialised host relationships part, or null when it was not changed. */
  updatedRelsXml(): string | null {
    if (!this.relsChanged || !this.relsDocument) return null;
    return serializeXml(this.relsDocument);
  }

  /** Serialised host content-types part, or null when it was not changed. */
  updatedContentTypesXml(): string | null {
    if (!this.contentTypesChanged) return null;
    return serializeXml(this.contentTypesDocument);
  }

  async importSource(source: SourceRelationshipInput): Promise<SourceRelationshipResult> {
    const relationships = relationshipMap(
      source.relsXml,
      `${source.fileName} ${RELATIONSHIPS_PART_PATH}`
    );
    const sourceEntries = new Set(source.pkg.info.entryNames);
    const sourceContentTypes = source.contentTypesXml
      ? parseContentTypes(source.contentTypesXml)
      : null;

    const idMap = new Map<string, string>();
    const seenReferences = new Set<string>();
    const mediaForSource = new Set<string>();
    // Scoped to this source on purpose. Two different files can share a name, so a map keyed by
    // name and part path would let the second source reuse the first source's media bytes.
    const mediaForSourcePath = new Map<string, string>();
    let hyperlinksImported = 0;

    for (const reference of collectRelationshipReferences(source.document)) {
      if (seenReferences.has(reference.id)) continue;
      seenReferences.add(reference.id);

      const relationship = relationships.get(reference.id);
      if (!relationship) {
        throw DocxErrors.unsupportedStructure(
          `"${source.fileName}" references a relationship that does not exist.`,
          `${reference.element.nodeName}@${reference.attribute.name}: ${reference.id}`
        );
      }

      const suffix = relationshipTypeSuffix(relationship.type);

      if (suffix === "image") {
        if (isExternal(relationship)) {
          throw DocxErrors.unsupportedStructure(
            `"${source.fileName}" links to an external image, which this merge does not fetch.`,
            `${reference.id} -> ${relationship.target}`
          );
        }

        const sourcePath = resolvePartTarget(DOCUMENT_PATH, relationship.target);
        if (!sourcePath || !sourceEntries.has(sourcePath)) {
          throw DocxErrors.unsupportedStructure(
            `"${source.fileName}" references an image part that is missing from its package.`,
            `${reference.id} -> ${relationship.target}`
          );
        }

        const sourceKey = sourcePath;
        let destinationPath = mediaForSourcePath.get(sourceKey);
        if (!destinationPath) {
          if (!sourceContentTypes) {
            throw DocxErrors.unsupportedStructure(
              `"${source.fileName}" has images but no content-types manifest.`,
              sourcePath
            );
          }
          const contentType = declaredContentType(sourceContentTypes, sourcePath);
          if (!contentType || !/^image\//i.test(contentType)) {
            throw DocxErrors.unsupportedStructure(
              `"${source.fileName}" declares an image part without an image content type.`,
              `${sourcePath}: ${contentType ?? "(no content type)"}`
            );
          }

          const bytes = await readDocxEntry(source.pkg, sourcePath, this.limits);
          destinationPath = this.allocateMediaPath(sourcePath);
          this.hostPkg.zip.file(destinationPath, bytes);
          this.addContentType(destinationPath, contentType, extensionOf(destinationPath));
          this.importedBytesByPath.set(destinationPath, bytes.length);
          this.importedMediaPaths.add(destinationPath);
          mediaForSourcePath.set(sourceKey, destinationPath);
          mediaForSource.add(destinationPath);

          const totalUncompressed = this.hostPkg.info.uncompressedSize + this.importedBytes;
          if (totalUncompressed > this.limits.maxUncompressedBytes) {
            throw DocxErrors.unsupportedStructure(
              "The merged document expands to more content than this workspace supports.",
              `${totalUncompressed} bytes, limit ${this.limits.maxUncompressedBytes}`
            );
          }
        }

        const newId = this.addRelationship(
          relationship.type,
          relativeTargetFromDocument(destinationPath),
          null
        );
        idMap.set(reference.id, newId);
        continue;
      }

      if (suffix === "hyperlink") {
        if (!isExternal(relationship)) {
          throw DocxErrors.unsupportedStructure(
            `"${source.fileName}" has a hyperlink relationship that is not external.`,
            `${reference.id} -> ${relationship.target}`
          );
        }
        const newId = this.addRelationship(relationship.type, relationship.target, "External");
        idMap.set(reference.id, newId);
        this.importedHyperlinkTargets.push(relationship.target);
        hyperlinksImported++;
        continue;
      }

      throw DocxErrors.unsupportedStructure(
        `"${source.fileName}" uses a relationship type this merge cannot preserve.`,
        `${suffix} -> ${relationship.target}`
      );
    }

    return {
      idMap,
      mediaImported: mediaForSource.size,
      hyperlinksImported,
    };
  }

  private ensureRelsPart(): { document: Document; root: Element } {
    if (this.relsDocument && this.relsRoot) {
      return { document: this.relsDocument, root: this.relsRoot };
    }

    const parsed = parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"/>`,
      `${RELATIONSHIPS_PART_PATH} (created)`
    ).document;
    this.relsDocument = parsed;
    this.relsRoot = parsed.documentElement;
    this.relsChanged = true;
    this.ensureDefaultContentType("rels", RELATIONSHIPS_CONTENT_TYPE);
    return { document: parsed, root: parsed.documentElement };
  }

  private addRelationship(type: string, target: string, targetMode: string | null): string {
    const { document, root } = this.ensureRelsPart();
    let id = `rId${this.nextRelationshipNumber}`;
    while (this.usedRelationshipIds.has(id)) {
      this.nextRelationshipNumber++;
      id = `rId${this.nextRelationshipNumber}`;
    }
    this.nextRelationshipNumber++;
    if (!Number.isSafeInteger(this.nextRelationshipNumber)) {
      throw DocxErrors.unsupportedStructure(
        "The merged document needs more relationships than this workspace supports."
      );
    }

    const element = document.createElementNS(RELATIONSHIPS_NAMESPACE, "Relationship");
    element.setAttribute("Id", id);
    element.setAttribute("Type", type);
    element.setAttribute("Target", target);
    if (targetMode) element.setAttribute("TargetMode", targetMode);
    root.appendChild(element);

    this.usedRelationshipIds.add(id);
    this.relsChanged = true;
    return id;
  }

  private allocateMediaPath(sourcePath: string): string {
    const slash = sourcePath.lastIndexOf("/");
    const base = sourcePath.slice(slash + 1);
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) {
      throw DocxErrors.unsupportedStructure(
        "An imported image has no usable file extension.",
        sourcePath
      );
    }
    const extension = base.slice(dot + 1);
    if (!/^[A-Za-z0-9]+$/.test(extension)) {
      throw DocxErrors.unsupportedStructure(
        "An imported image has an unusable file extension.",
        `${sourcePath}: ${extension}`
      );
    }

    const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._-]/g, "_") || "image";
    let candidate = `${MEDIA_PREFIX}${stem}.${extension}`;
    let counter = 2;
    while (this.usedPartPaths.has(escapeCase(candidate))) {
      candidate = `${MEDIA_PREFIX}${stem}-${counter}.${extension}`;
      counter++;
    }
    this.usedPartPaths.add(escapeCase(candidate));
    return candidate;
  }

  private findContentType(extension: string): Element | undefined {
    return elementChildren(this.contentTypesRoot).find(
      (element) =>
        element.namespaceURI === CONTENT_TYPES_NAMESPACE &&
        element.localName === "Default" &&
        (element.getAttribute("Extension") ?? "").toLowerCase() === extension.toLowerCase()
    );
  }

  private findOverride(partPath: string): Element | undefined {
    return elementChildren(this.contentTypesRoot).find(
      (element) =>
        element.namespaceURI === CONTENT_TYPES_NAMESPACE &&
        element.localName === "Override" &&
        (element.getAttribute("PartName") ?? "").replace(/^\/+/, "") === partPath
    );
  }

  private ensureDefaultContentType(extension: string, contentType: string): void {
    const existing = this.findContentType(extension);
    if (existing) {
      if ((existing.getAttribute("ContentType") ?? "").toLowerCase() !== contentType.toLowerCase()) {
        throw DocxErrors.unsupportedStructure(
          "The host document already assigns a different content type to this extension.",
          `${extension}: ${existing.getAttribute("ContentType")}`
        );
      }
      return;
    }
    this.appendContentTypeElement("Default", {
      Extension: extension.toLowerCase(),
      ContentType: contentType,
    });
  }

  private addContentType(partPath: string, contentType: string, extension: string): void {
    const override = this.findOverride(partPath);
    if (override) {
      if ((override.getAttribute("ContentType") ?? "").toLowerCase() !== contentType.toLowerCase()) {
        throw DocxErrors.unsupportedStructure(
          "The host document already assigns a different content type to this part.",
          `${partPath}: ${override.getAttribute("ContentType")}`
        );
      }
      return;
    }

    const existing = this.findContentType(extension);
    if (!existing) {
      this.appendContentTypeElement("Default", {
        Extension: extension.toLowerCase(),
        ContentType: contentType,
      });
      return;
    }
    if ((existing.getAttribute("ContentType") ?? "").toLowerCase() === contentType.toLowerCase()) {
      return;
    }

    // The extension default describes the host's own files; a part-level Override preserves the
    // imported file's real type without changing host semantics.
    this.appendContentTypeElement("Override", {
      PartName: `/${partPath}`,
      ContentType: contentType,
    });
  }

  private appendContentTypeElement(
    localName: "Default" | "Override",
    attributes: Record<string, string>
  ): void {
    const element = this.contentTypesDocument.createElementNS(
      CONTENT_TYPES_NAMESPACE,
      localName
    );
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    this.contentTypesRoot.appendChild(element);
    this.contentTypesChanged = true;
  }
}

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1);
};

/** Relationship targets are resolved relative to `word/document.xml`, so media lives under `media/`. */
const relativeTargetFromDocument = (destinationPath: string): string => {
  if (destinationPath.startsWith("word/")) return destinationPath.slice("word/".length);
  throw DocxErrors.unsupportedStructure(
    "An imported part was placed outside the document's package scope.",
    destinationPath
  );
};
