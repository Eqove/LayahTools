/**
 * DOCX merge tests (phase 9.1).
 *
 * Fixtures are built in memory so every case is deterministic. Real Word files are exercised
 * when present on this machine: they are the honest test of re-zipping and namespace handling.
 */

import fs from "node:fs";
import JSZip from "jszip";
import {
  DEFAULT_DOCX_LIMITS,
  DOCX_MIME_TYPE,
  WORD_NAMESPACE,
} from "../src/lib/docx/constants";
import { isDocxError } from "../src/lib/docx/errors";
import { mergeDocxDocuments, toMergedDocxFileName } from "../src/lib/docx/merge";
import { collectBodyText, countParagraphs, countTables } from "../src/lib/docx/merge/body";
import { isPartTyped, parseContentTypes, parseRelationships } from "../src/lib/docx/merge/package";
import { parseXml } from "../src/lib/docx/xml";
import { validateDocxFile } from "../src/lib/docx/validate";

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};
const codeOf = (value: unknown) => (isDocxError(value) ? value.code : `not-docx-error:${String(value)}`);
const resultCode = (result: { ok: true } | { ok: false; error: unknown }): string =>
  result.ok ? "ok" : codeOf(result.error);

const W = WORD_NAMESPACE;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

const STYLES_NS = `xmlns:w="${W}"`;
const DEFAULT_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${STYLES_NS}><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const DEFAULT_NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${STYLES_NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Merge fixture</dc:title></cp:coreProperties>`;
const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Fixture</Application></Properties>`;

interface FixtureOptions {
  body: string;
  /** null omits the part entirely. */
  styles?: string | null;
  numbering?: string | null;
  documentRelsExtra?: string;
  documentRootAttributes?: string;
  documentIgnorable?: string;
  extraEntries?: Record<string, string | Uint8Array>;
  contentTypesExtra?: string;
  omitDocumentRels?: boolean;
}

const REL_TYPES = {
  styles: `${REL}/styles`,
  numbering: `${REL}/numbering`,
  image: `${REL}/image`,
  hyperlink: `${REL}/hyperlink`,
  header: `${REL}/header`,
  footer: `${REL}/footer`,
  footnotes: `${REL}/footnotes`,
  endnotes: `${REL}/endnotes`,
  comments: `${REL}/comments`,
  chart: `${REL}/chart`,
  diagram: `${REL}/diagram`,
  oleObject: `${REL}/oleObject`,
} as const;

const CONTENT_TYPES = {
  styles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  numbering: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  core: "application/vnd.openxmlformats-package.core-properties+xml",
  app: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  header: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  footer: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
  footnotes: "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
  endnotes: "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
  comments: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  diagram: "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
  customXml: "application/xml",
} as const;

async function buildDocx(options: FixtureOptions): Promise<Uint8Array> {
  const styles = options.styles === undefined ? DEFAULT_STYLES : options.styles;
  const numbering = options.numbering === undefined ? DEFAULT_NUMBERING : options.numbering;
  const hasStyles = styles !== null;
  const hasNumbering = numbering !== null;

  const overrides = [
    `<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.document}"/>`,
    hasStyles ? `<Override PartName="/word/styles.xml" ContentType="${CONTENT_TYPES.styles}"/>` : "",
    hasNumbering ? `<Override PartName="/word/numbering.xml" ContentType="${CONTENT_TYPES.numbering}"/>` : "",
    `<Override PartName="/docProps/core.xml" ContentType="${CONTENT_TYPES.core}"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="${CONTENT_TYPES.app}"/>`,
    options.contentTypesExtra ?? "",
  ].join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  ${overrides}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">
  <Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">
  ${hasStyles ? `<Relationship Id="rId1" Type="${REL_TYPES.styles}" Target="styles.xml"/>` : ""}
  ${hasNumbering ? `<Relationship Id="rId2" Type="${REL_TYPES.numbering}" Target="numbering.xml"/>` : ""}
  ${options.documentRelsExtra ?? ""}
</Relationships>`;

  const ignorable = options.documentIgnorable ?? "w14";
  const extraAttributes = options.documentRootAttributes
    ? ` ${options.documentRootAttributes}`
    : "";
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${REL}" xmlns:mc="${MC}" xmlns:w14="${W14}" mc:Ignorable="${ignorable}"${extraAttributes}><w:body>${options.body}</w:body></w:document>`;

  const entries: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rootRels,
    "word/document.xml": document,
    "docProps/core.xml": CORE,
    "docProps/app.xml": APP,
    ...(hasStyles ? { "word/styles.xml": styles } : {}),
    ...(hasNumbering ? { "word/numbering.xml": numbering } : {}),
    ...(options.omitDocumentRels ? {} : { "word/_rels/document.xml.rels": documentRels }),
    ...(options.extraEntries ?? {}),
  };

  const zip = new JSZip();
  for (const [path, value] of Object.entries(entries)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

const docxFile = (bytes: Uint8Array, name: string) =>
  new File([bytes as BlobPart], name, { type: DOCX_MIME_TYPE, lastModified: 1 });

const paragraph = (text: string, extra = "") =>
  `<w:p>${extra}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const bulletParagraph = (text: string, numId: number) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const table = (text: string, nested = ""): string =>
  `<w:tbl><w:tr><w:tc>${paragraph(text)}${nested}</w:tc></w:tr></w:tbl>`;

/** A minimal but structurally valid DrawingML picture paragraph. */
const drawingParagraph = (embedId: string, kind: "inline" | "anchor" = "inline"): string => {
  const anchorAttributes =
    kind === "anchor"
      ? ` distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"`
      : "";
  const anchorPosition =
    kind === "anchor"
      ? `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>`
      : "";
  return `<w:p><w:r><w:drawing><wp:${kind} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"${anchorAttributes}>${anchorPosition}<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="picture.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${embedId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:${kind}></w:drawing></w:r></w:p>`;
};

const imageRelationship = (id: string, target: string, external = false): string =>
  `<Relationship Id="${id}" Type="${REL_TYPES.image}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;

const hyperlinkRelationship = (id: string, target: string, external = true): string =>
  `<Relationship Id="${id}" Type="${REL_TYPES.hyperlink}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;

const bookmarkParagraph = (id: number, name: string, text: string): string =>
  `<w:p><w:bookmarkStart w:id="${id}" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r><w:bookmarkEnd w:id="${id}"/></w:p>`;

const anchorHyperlink = (name: string, text: string): string =>
  `<w:hyperlink w:anchor="${name}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink>`;

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

/** xmldom NodeLists are array-like but not iterable, so collect them explicitly. */
const elementsOf = (root: Document | Element, localName: string): Element[] => {
  const list = root.getElementsByTagNameNS(W, localName);
  const elements: Element[] = [];
  for (let index = 0; index < list.length; index++) elements.push(list[index]);
  return elements;
};

const readEntry = async (bytes: Uint8Array, path: string): Promise<Uint8Array> => {
  const entry = (await JSZip.loadAsync(bytes)).file(path);
  if (!entry) throw new Error(`missing entry ${path}`);
  return entry.async("uint8array");
};
const readEntryText = async (bytes: Uint8Array, path: string): Promise<string> =>
  new TextDecoder().decode(await readEntry(bytes, path));

const outputDocument = async (bytes: Uint8Array): Promise<Document> =>
  parseXml(await readEntryText(bytes, "word/document.xml")).document;

const mergeCount = (value: string, needle: string): number => value.split(needle).length - 1;

const bodyOf = (document: Document): Element => {
  const bodies = document.getElementsByTagNameNS(W, "body");
  if (bodies.length === 0) throw new Error("missing body");
  return bodies[0];
};

const directSectPrs = (document: Document): Element[] => {
  const body = bodyOf(document);
  const result: Element[] = [];
  for (let index = 0; index < body.childNodes.length; index++) {
    const node = body.childNodes[index];
    if (node.nodeType === 1) {
      const element = node as Element;
      if (element.namespaceURI === W && element.localName === "sectPr") result.push(element);
    }
  }
  return result;
};

const inlineSectPrs = (document: Document): number =>
  document.getElementsByTagNameNS(W, "sectPr").length - directSectPrs(document).length;

const bodyNumIds = (document: Document): number[] => {
  const values: number[] = [];
  const elements = document.getElementsByTagNameNS(W, "numId");
  for (let index = 0; index < elements.length; index++) {
    const value = elements[index].getAttributeNS(W, "val");
    if (value !== null && value !== "0") values.push(Number(value));
  }
  return values;
};

async function main() {
  // =========================================================================
  // FILENAME
  // =========================================================================
  check("filename for 1", toMergedDocxFileName(1) === "merged-1-documents.docx");
  check("filename for 2", toMergedDocxFileName(2) === "merged-2-documents.docx");
  check("filename for 3", toMergedDocxFileName(3) === "merged-3-documents.docx");
  check("filename clamps zero", toMergedDocxFileName(0) === "merged-1-documents.docx");
  check("filename clamps negative", toMergedDocxFileName(-4) === "merged-1-documents.docx");
  check("filename handles NaN", toMergedDocxFileName(Number.NaN) === "merged-1-documents.docx");

  // =========================================================================
  // BASIC MERGES
  // =========================================================================
  const alpha = await buildDocx({ body: `${paragraph("Alpha")}<w:sectPr/>` });
  const beta = await buildDocx({ body: `${paragraph("Beta")}<w:sectPr/>` });
  const gamma = await buildDocx({ body: `${paragraph("Gamma")}<w:sectPr/>` });

  const two = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(beta, "beta.docx") },
  ]);
  check("two-document merge succeeds", two.ok);
  if (!two.ok) {
    console.error(two.error);
    console.log(`\n${failed + 1} FAILED`);
    process.exit(1);
  }

  check("two-document source count", two.value.sourceCount === 2);
  check("two-document default output name", two.value.outputFileName === "merged-2-documents.docx");
  check("two-document MIME type", two.value.mimeType === DOCX_MIME_TYPE && two.value.blob.type === DOCX_MIME_TYPE);
  check("two-document byte length", two.value.byteLength === two.value.bytes.length && two.value.blob.size === two.value.byteLength);
  check("two-document paragraphs", two.value.merged.paragraphs === 3);
  check("two-document tables", two.value.merged.tables === 0);
  check("two-document section breaks", two.value.merged.sectionBreaks === 1);
  check("two-document text order", collectBodyText(await outputDocument(two.value.bytes)).replace(/\s+/g, " ") === "Alpha Beta");
  check("two-document verification", Object.values(two.value.verification).every(Boolean));
  check("two-document output validates", (await validateDocxFile(two.value.bytes, { name: two.value.outputFileName })).ok);

  const three = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(beta, "beta.docx") },
    { input: docxFile(gamma, "gamma.docx") },
  ]);
  check("three-document merge succeeds", three.ok);
  if (three.ok) {
    check("three-document paragraphs", three.value.merged.paragraphs === 5);
    check("three-document section breaks", three.value.merged.sectionBreaks === 2);
    check("three-document order", collectBodyText(await outputDocument(three.value.bytes)).replace(/\s+/g, " ") === "Alpha Beta Gamma");
    check("three-document style count", three.value.merged.styles >= 1);
    check("three-document output validates", (await validateDocxFile(three.value.bytes, { name: three.value.outputFileName })).ok);
  }

  const reordered = await mergeDocxDocuments([
    { input: docxFile(beta, "beta.docx") },
    { input: docxFile(alpha, "alpha.docx") },
  ]);
  check("reordered input is honoured", reordered.ok && collectBodyText(await outputDocument(reordered.value.bytes)).replace(/\s+/g, " ") === "Beta Alpha");

  const duplicateFile = docxFile(alpha, "alpha.docx");
  const duplicate = await mergeDocxDocuments([
    { input: duplicateFile },
    { input: duplicateFile },
  ]);
  check("duplicate input merges twice", duplicate.ok && collectBodyText(await outputDocument(duplicate.value.bytes)).replace(/\s+/g, " ") === "Alpha Alpha");
  check("duplicate input keeps source count", duplicate.ok && duplicate.value.sourceCount === 2);

  const empty = await mergeDocxDocuments([]);
  check("empty queue is rejected", !empty.ok && resultCode(empty) === "EMPTY_DOCUMENT");
  check("empty queue returns no output", !("value" in empty));

  const singleFile = docxFile(alpha, "single.docx");
  const single = await mergeDocxDocuments([{ input: singleFile }]);
  check("single input succeeds", single.ok);
  if (single.ok) {
    check("single input is a pass-through", single.value.sourceCount === 1 && single.value.merged.paragraphs === 1 && single.value.merged.sectionBreaks === 0);
    check("single input text survives", collectBodyText(await outputDocument(single.value.bytes)) === "Alpha");
    check("single input output validates", (await validateDocxFile(single.value.bytes, { name: single.value.outputFileName })).ok);
    check("single input has one body sectPr", directSectPrs(await outputDocument(single.value.bytes)).length === 1 && inlineSectPrs(await outputDocument(single.value.bytes)) === 0);
  }

  const badBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
  const invalidFirst = await mergeDocxDocuments([{ input: badBytes, name: "bad.docx" }]);
  check("invalid first input is rejected", !invalidFirst.ok && resultCode(invalidFirst) === "CORRUPTED_PACKAGE");
  check("invalid first input returns no output", !("value" in invalidFirst));

  const invalidSecond = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: badBytes, name: "bad.docx" },
  ]);
  check("invalid second input is rejected", !invalidSecond.ok && resultCode(invalidSecond) === "CORRUPTED_PACKAGE");
  check("invalid second input returns no output", !("value" in invalidSecond));

  const guarded = docxFile(alpha, "guarded.docx");
  const guardedSnapshot = new Uint8Array(await guarded.arrayBuffer());
  const guardedSize = guarded.size;
  const guardedResult = await mergeDocxDocuments([{ input: guarded }, { input: docxFile(beta, "beta.docx") }]);
  const guardedAfter = new Uint8Array(await guarded.arrayBuffer());
  check("original File bytes are unchanged", guardedSnapshot.length === guardedAfter.length && guardedSnapshot.every((byte, index) => byte === guardedAfter[index]));
  check("original File metadata is unchanged", guarded.size === guardedSize && guarded.name === "guarded.docx");
  check("merged bytes are an independent array", guardedResult.ok && guardedResult.value.bytes !== guardedSnapshot);

  const arrayBufferResult = await mergeDocxDocuments([
    { input: alpha.buffer.slice(0) as ArrayBuffer, name: "alpha.docx", mimeType: DOCX_MIME_TYPE },
    { input: beta.buffer.slice(0) as ArrayBuffer, name: "beta.docx", mimeType: DOCX_MIME_TYPE },
  ]);
  check("ArrayBuffer input is accepted", arrayBufferResult.ok && arrayBufferResult.value.sourceCount === 2);

  const customName = await mergeDocxDocuments([{ input: alpha, name: "alpha.docx" }, { input: beta, name: "beta.docx" }], { outputName: "combined" });
  check("output name gains .docx", customName.ok && customName.value.outputFileName === "combined.docx");
  const customName2 = await mergeDocxDocuments([{ input: alpha, name: "alpha.docx" }], { outputName: "already.docx" });
  check("output name keeps .docx", customName2.ok && customName2.value.outputFileName === "already.docx");

  // =========================================================================
  // PARAGRAPHS, TABLES, NESTED TABLES, FORMATTING
  // =========================================================================
  const multiA = await buildDocx({
    body: `${paragraph("A1")}${paragraph("A2")}${paragraph("A3")}<w:sectPr/>`,
  });
  const multiB = await buildDocx({
    body: `${paragraph("B1")}${paragraph("B2")}${table("Cell one")}${table("Cell two")}<w:sectPr/>`,
  });
  const tables = await mergeDocxDocuments([
    { input: docxFile(multiA, "multi-a.docx") },
    { input: docxFile(multiB, "multi-b.docx") },
  ]);
  check("table merge succeeds", tables.ok);
  if (tables.ok) {
    check("table merge paragraph count", tables.value.merged.paragraphs === 8);
    check("table merge table count", tables.value.merged.tables === 2);
    check("table merge text order", collectBodyText(await outputDocument(tables.value.bytes)).replace(/\s+/g, " ") === "A1 A2 A3 B1 B2 Cell one Cell two");
    check("table merge output validates", (await validateDocxFile(tables.value.bytes, { name: tables.value.outputFileName })).ok);
  }

  const nestedA = await buildDocx({ body: `${paragraph("Outer")}<w:sectPr/>` });
  const nestedB = await buildDocx({
    body: `${table("Outer cell", table("Inner cell"))}<w:sectPr/>`,
  });
  const nested = await mergeDocxDocuments([
    { input: docxFile(nestedA, "nested-a.docx") },
    { input: docxFile(nestedB, "nested-b.docx") },
  ]);
  check("nested table merge succeeds", nested.ok);
  if (nested.ok) {
    check("nested table count", nested.value.merged.tables === 2);
    check("nested table text survives", collectBodyText(await outputDocument(nested.value.bytes)).includes("Inner cell"));
    check("nested table output validates", (await validateDocxFile(nested.value.bytes, { name: nested.value.outputFileName })).ok);
  }

  const formattedB = await buildDocx({
    body: `<w:p><w:r><w:rPr><w:b/><w:color w:val="FF00FF"/></w:rPr><w:t>Formatted</w:t></w:r></w:p><w:sectPr/>`,
  });
  const formatting = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(formattedB, "formatted.docx") },
  ]);
  const formattingXml = formatting.ok ? await readEntryText(formatting.value.bytes, "word/document.xml") : "";
  check("direct run formatting survives", formatting.ok && formattingXml.includes("<w:b") && formattingXml.includes('w:color w:val="FF00FF"'));

  // =========================================================================
  // STYLES
  // =========================================================================
  const hostStyles = `<?xml version="1.0"?><w:styles ${STYLES_NS}>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="CustomA"><w:name w:val="Custom A"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="AA0000"/></w:rPr></w:style>
</w:styles>`;
  const otherStyles = `<?xml version="1.0"?><w:styles ${STYLES_NS}>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:color w:val="0000FF"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="CustomB"><w:name w:val="Custom B"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="00AA00"/></w:rPr></w:style>
</w:styles>`;
  const styleHost = await buildDocx({
    body: `<w:p><w:pPr><w:pStyle w:val="CustomA"/></w:pPr><w:r><w:t>Host style</w:t></w:r></w:p><w:sectPr/>`,
    styles: hostStyles,
  });
  const styleOther = await buildDocx({
    body: `<w:p><w:pPr><w:pStyle w:val="CustomB"/></w:pPr><w:r><w:t>Other style</w:t></w:r></w:p><w:sectPr/>`,
    styles: otherStyles,
  });
  const styles = await mergeDocxDocuments([
    { input: docxFile(styleHost, "style-host.docx") },
    { input: docxFile(styleOther, "style-other.docx") },
  ]);
  check("style merge succeeds", styles.ok);
  if (styles.ok) {
    const mergedStyles = await readEntryText(styles.value.bytes, "word/styles.xml");
    check("style conflict is warned", styles.value.warnings.some((warning) => warning.code === "MERGE_STYLE_CONFLICT" && warning.detail?.includes("Normal")));
    check("first document style wins", mergeCount(mergedStyles, 'w:styleId="Normal"') === 1 && mergedStyles.includes('w:color w:val="FF0000"') && !mergedStyles.includes('w:color w:val="0000FF"'));
    check("missing style is imported", mergeCount(mergedStyles, 'w:styleId="CustomB"') === 1 && styles.value.sources[1].stylesImported === 1);
    check("host style remains", mergedStyles.includes('w:styleId="CustomA"'));
    check("style references resolve", styles.value.verification.styleReferencesResolved);
    check("style merge output validates", (await validateDocxFile(styles.value.bytes, { name: styles.value.outputFileName })).ok);
  }

  const identicalOther = await buildDocx({
    body: paragraph("Identical"),
    styles: `<?xml version="1.0"?><w:styles ${STYLES_NS}><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CustomA"><w:name w:val="Custom A"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="AA0000"/></w:rPr></w:style></w:styles>`,
  });
  const identical = await mergeDocxDocuments([
    { input: docxFile(styleHost, "style-host.docx") },
    { input: docxFile(identicalOther, "identical.docx") },
  ]);
  check("identical styles do not warn", identical.ok && !identical.value.warnings.some((warning) => warning.code === "MERGE_STYLE_CONFLICT" && warning.detail?.includes("CustomA")));
  check("identical styles are not re-imported", identical.ok && identical.value.sources[1].stylesImported === 0);

  const docDefaultsHost = await buildDocx({
    body: paragraph("Defaults"),
    styles: `<?xml version="1.0"?><w:styles ${STYLES_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  });
  const docDefaultsOther = await buildDocx({
    body: paragraph("Other defaults"),
    styles: `<?xml version="1.0"?><w:styles ${STYLES_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  });
  const docDefaults = await mergeDocxDocuments([
    { input: docxFile(docDefaultsHost, "defaults-host.docx") },
    { input: docxFile(docDefaultsOther, "defaults-other.docx") },
  ]);
  check("differing docDefaults are warned", docDefaults.ok && docDefaults.value.warnings.some((warning) => warning.code === "MERGE_STYLE_CONFLICT" && warning.detail?.includes("docDefaults")));

  const hostWithoutStyles = await buildDocx({
    body: paragraph("No styles part"),
    styles: null,
  });
  const missingHostStyles = await mergeDocxDocuments([
    { input: docxFile(hostWithoutStyles, "no-styles.docx") },
    { input: docxFile(styleOther, "style-other.docx") },
  ]);
  check("host without styles refuses imported styles", !missingHostStyles.ok && resultCode(missingHostStyles) === "UNSUPPORTED_STRUCTURE");

  // =========================================================================
  // NUMBERING
  // =========================================================================
  const decimalNumbering = `<?xml version="1.0"?><w:numbering ${STYLES_NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const listHost = await buildDocx({ body: `${bulletParagraph("List host", 1)}<w:sectPr/>` });
  const listOther = await buildDocx({
    body: `${bulletParagraph("List other one", 1)}${bulletParagraph("List other two", 1)}<w:sectPr/>`,
    numbering: decimalNumbering,
  });
  const lists = await mergeDocxDocuments([
    { input: docxFile(listHost, "list-host.docx") },
    { input: docxFile(listOther, "list-other.docx") },
  ]);
  check("list merge succeeds", lists.ok);
  if (lists.ok) {
    const numberingXml = await readEntryText(lists.value.bytes, "word/numbering.xml");
    const outputDocumentValue = await outputDocument(lists.value.bytes);
    const numIds = [...numberingXml.matchAll(/<w:num w:numId="(\d+)"/g)].map((match) => Number(match[1]));
    const abstractIds = [...numberingXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"/g)].map((match) => Number(match[1]));
    check("numbering IDs are unique", new Set(numIds).size === numIds.length && new Set(abstractIds).size === abstractIds.length);
    check("numbering IDs are reallocated numerically", numIds.includes(1) && numIds.includes(2) && abstractIds.includes(0) && abstractIds.includes(1));
    check("body numbering references are remapped", bodyNumIds(outputDocumentValue).join(",") === "1,2,2");
    check("list formats survive", numberingXml.includes('w:numFmt w:val="bullet"') && numberingXml.includes('w:numFmt w:val="decimal"'));
    check("numbering import is attributed", lists.value.sources[1].numberingImported === 1);
    check("list merge output validates", (await validateDocxFile(lists.value.bytes, { name: lists.value.outputFileName })).ok);
  }

  const danglingNumbering = await buildDocx({
    body: `${bulletParagraph("Dangling", 9)}<w:sectPr/>`,
    numbering: decimalNumbering,
  });
  const dangling = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(danglingNumbering, "dangling.docx") },
  ]);
  check("dangling numbering reference is refused", !dangling.ok && resultCode(dangling) === "UNSUPPORTED_STRUCTURE");

  const hostWithoutNumbering = await buildDocx({
    body: `${bulletParagraph("No numbering part", 1)}<w:sectPr/>`,
    numbering: null,
  });
  const missingHostNumbering = await mergeDocxDocuments([
    { input: docxFile(hostWithoutNumbering, "no-numbering.docx") },
    { input: docxFile(listOther, "list-other.docx") },
  ]);
  check("host without numbering refuses list content", !missingHostNumbering.ok && resultCode(missingHostNumbering) === "UNSUPPORTED_STRUCTURE");

  const malformedNumbering = await buildDocx({
    body: paragraph("Bad numbering"),
    numbering: `<w:numbering ${STYLES_NS}><w:num w:numId="1">`,
  });
  const malformedNumberingResult = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(malformedNumbering, "bad-numbering.docx") },
  ]);
  check("malformed numbering is rejected", !malformedNumberingResult.ok && resultCode(malformedNumberingResult) === "CORRUPTED_PACKAGE");

  const missingAbstract = await buildDocx({
    body: `${bulletParagraph("Missing abstract", 1)}<w:sectPr/>`,
    numbering: `<?xml version="1.0"?><w:numbering ${STYLES_NS}><w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num></w:numbering>`,
  });
  const missingAbstractResult = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(missingAbstract, "missing-abstract.docx") },
  ]);
  check("missing abstract numbering is refused", !missingAbstractResult.ok && resultCode(missingAbstractResult) === "UNSUPPORTED_STRUCTURE");

  const numIdFive = await buildDocx({
    body: `${bulletParagraph("Five", 5)}<w:sectPr/>`,
    numbering: `<?xml version="1.0"?><w:numbering ${STYLES_NS}><w:abstractNum w:abstractNumId="9"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="9"/></w:num></w:numbering>`,
  });
  const five = await mergeDocxDocuments([
    { input: docxFile(listHost, "list-host.docx") },
    { input: docxFile(numIdFive, "num-five.docx") },
  ]);
  check("high non-host numId is allocated numerically", five.ok && bodyNumIds(await outputDocument(five.value.bytes)).join(",") === "1,2");

  // =========================================================================
  // UNSUPPORTED RELATIONSHIP-DEPENDENT CONTENT
  // =========================================================================

  const expectUnsupported = async (label: string, fixture: Uint8Array) => {
    const result = await mergeDocxDocuments([
      { input: docxFile(alpha, "alpha.docx") },
      { input: docxFile(fixture, "unsupported.docx") },
    ]);
    check(`${label} is refused`, !result.ok && resultCode(result) === "UNSUPPORTED_STRUCTURE");
    check(
      `${label} emits MERGE_CONTENT_UNSUPPORTED`,
      !result.ok && result.warnings.some((warning) => warning.code === "MERGE_CONTENT_UNSUPPORTED")
    );
  };

  const headerXml = `<?xml version="1.0"?><w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>`;
  const footerXml = `<?xml version="1.0"?><w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>`;
  const notesXml = (tag: string) =>
    `<?xml version="1.0"?><w:${tag} xmlns:w="${W}"><w:${tag === "footnotes" ? "footnote" : "endnote"} w:id="1"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:${tag === "footnotes" ? "footnote" : "endnote"}></w:${tag}>`;
  const commentsXml = `<?xml version="1.0"?><w:comments xmlns:w="${W}"><w:comment w:id="1"><w:p><w:r><w:t>Comment</w:t></w:r></w:p></w:comment></w:comments>`;

  await expectUnsupported(
    "header part",
    await buildDocx({
      body: `${paragraph("Header part")}<w:sectPr/>`,
      extraEntries: { "word/header1.xml": headerXml },
      contentTypesExtra: `<Override PartName="/word/header1.xml" ContentType="${CONTENT_TYPES.header}"/>`,
    })
  );

  await expectUnsupported(
    "footer part",
    await buildDocx({
      body: `${paragraph("Footer part")}<w:sectPr/>`,
      extraEntries: { "word/footer1.xml": footerXml },
      contentTypesExtra: `<Override PartName="/word/footer1.xml" ContentType="${CONTENT_TYPES.footer}"/>`,
    })
  );

  await expectUnsupported(
    "footnotes part",
    await buildDocx({
      body: `${paragraph("Footnotes part")}<w:sectPr/>`,
      extraEntries: { "word/footnotes.xml": notesXml("footnotes") },
      contentTypesExtra: `<Override PartName="/word/footnotes.xml" ContentType="${CONTENT_TYPES.footnotes}"/>`,
    })
  );

  await expectUnsupported(
    "endnotes part",
    await buildDocx({
      body: `${paragraph("Endnotes part")}<w:sectPr/>`,
      extraEntries: { "word/endnotes.xml": notesXml("endnotes") },
      contentTypesExtra: `<Override PartName="/word/endnotes.xml" ContentType="${CONTENT_TYPES.endnotes}"/>`,
    })
  );

  await expectUnsupported(
    "comments part",
    await buildDocx({
      body: `${paragraph("Comments part")}<w:sectPr/>`,
      extraEntries: { "word/comments.xml": commentsXml },
      contentTypesExtra: `<Override PartName="/word/comments.xml" ContentType="${CONTENT_TYPES.comments}"/>`,
    })
  );

  await expectUnsupported(
    "chart part",
    await buildDocx({
      body: `${paragraph("Chart part")}<w:sectPr/>`,
      extraEntries: { "word/charts/chart1.xml": `<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>` },
      contentTypesExtra: `<Override PartName="/word/charts/chart1.xml" ContentType="${CONTENT_TYPES.chart}"/>`,
    })
  );

  await expectUnsupported(
    "diagram part",
    await buildDocx({
      body: `${paragraph("Diagram part")}<w:sectPr/>`,
      extraEntries: { "word/diagrams/data1.xml": `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>` },
    })
  );

  await expectUnsupported(
    "inline chart drawing",
    await buildDocx({
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></wp:inline></w:drawing></w:r></w:p><w:sectPr/>`,
    })
  );

  await expectUnsupported(
    "inline SmartArt drawing",
    await buildDocx({
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rIdDm"/></wp:inline></w:drawing></w:r></w:p><w:sectPr/>`,
    })
  );

  await expectUnsupported(
    "image with no content-type declaration",
    await buildDocx({
      body: `${drawingParagraph("rIdNoType")}<w:sectPr/>`,
      extraEntries: { "word/media/image1.webp": new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      documentRelsExtra: imageRelationship("rIdNoType", "media/image1.webp"),
    })
  );

  await expectUnsupported(
    "embedded object part",
    await buildDocx({
      body: `${paragraph("Embedded object")}<w:sectPr/>`,
      extraEntries: { "word/embeddings/oleObject1.bin": new Uint8Array([1, 2, 3]) },
    })
  );

  await expectUnsupported(
    "embedded font part",
    await buildDocx({
      body: `${paragraph("Embedded font")}<w:sectPr/>`,
      extraEntries: { "word/fonts/font1.odttf": new Uint8Array([4, 5, 6]) },
    })
  );

  await expectUnsupported(
    "custom XML part",
    await buildDocx({
      body: `${paragraph("Custom XML part")}<w:sectPr/>`,
      extraEntries: { "customXml/item1.xml": `<?xml version="1.0"?><root/>` },
    })
  );

  await expectUnsupported(
    "glossary part",
    await buildDocx({
      body: `${paragraph("Glossary part")}<w:sectPr/>`,
      extraEntries: { "word/glossary/document.xml": `<?xml version="1.0"?><w:glossaryDocument xmlns:w="${W}"/>` },
    })
  );

  await expectUnsupported(
    "signature part",
    await buildDocx({
      body: `${paragraph("Signature part")}<w:sectPr/>`,
      extraEntries: { "_xmlsignatures/sig1.xml": `<?xml version="1.0"?><Signature/>` },
    })
  );

  await expectUnsupported(
    "ActiveX part",
    await buildDocx({
      body: `${paragraph("ActiveX part")}<w:sectPr/>`,
      extraEntries: { "word/activeX/activeX1.xml": `<?xml version="1.0"?><ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX"/>` },
    })
  );

  await expectUnsupported(
    "altChunk",
    await buildDocx({ body: `<w:altChunk r:id="rId9"/><w:sectPr/>` })
  );

  await expectUnsupported(
    "subdocument",
    await buildDocx({ body: `<w:subDoc r:id="rId9"/><w:sectPr/>` })
  );

  await expectUnsupported(
    "OLE object",
    await buildDocx({
      body: `<w:p><w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office"><o:OLEObject Type="Embed"/></w:object></w:r></w:p><w:sectPr/>`,
    })
  );

  await expectUnsupported(
    "footnote reference",
    await buildDocx({ body: `${paragraph("Note")}<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr/>` })
  );

  await expectUnsupported(
    "endnote reference",
    await buildDocx({ body: `${paragraph("Note")}<w:p><w:r><w:endnoteReference w:id="1"/></w:r></w:p><w:sectPr/>` })
  );

  await expectUnsupported(
    "comment reference",
    await buildDocx({ body: `${paragraph("Comment")}<w:p><w:r><w:commentReference w:id="1"/></w:r></w:p><w:sectPr/>` })
  );

  await expectUnsupported(
    "unmatched bookmark start",
    await buildDocx({ body: `${paragraph("Bookmarked", '<w:bookmarkStart w:id="0" w:name="bm"/>')}<w:sectPr/>` })
  );

  await expectUnsupported(
    "unmatched bookmark end",
    await buildDocx({ body: `${paragraph("Bookmarked", '<w:bookmarkEnd w:id="0"/>')}<w:sectPr/>` })
  );

  await expectUnsupported(
    "hyperlink with a missing relationship",
    await buildDocx({ body: `<w:hyperlink r:id="rId9"><w:r><w:t>Link</w:t></w:r></w:hyperlink><w:sectPr/>` })
  );

  await expectUnsupported(
    "image with a missing relationship",
    await buildDocx({ body: `${drawingParagraph("rId9")}<w:sectPr/>` })
  );

  await expectUnsupported(
    "header reference",
    await buildDocx({
      body: `${paragraph("Header ref")}<w:sectPr><w:headerReference w:type="default" r:id="rId9"/></w:sectPr>`,
    })
  );

  await expectUnsupported(
    "footer reference",
    await buildDocx({
      body: `${paragraph("Footer ref")}<w:sectPr><w:footerReference w:type="default" r:id="rId9"/></w:sectPr>`,
    })
  );

  await expectUnsupported(
    "custom XML markup",
    await buildDocx({
      body: `<w:customXml w:element="x">${paragraph("Custom markup")}</w:customXml><w:sectPr/>`,
    })
  );

  await expectUnsupported(
    "unknown relationship type",
    await buildDocx({
      body: `${paragraph("Unknown relationship")}<w:sectPr/>`,
      extraEntries: { "word/thing.xml": `<?xml version="1.0"?><thing/>` },
      documentRelsExtra: `<Relationship Id="rIdX" Type="${REL}/unknownThing" Target="thing.xml"/>`,
    })
  );

  await expectUnsupported(
    "picture bullets",
    await buildDocx({
      body: `${bulletParagraph("Picture bullet", 1)}<w:sectPr/>`,
      numbering: `<?xml version="1.0"?><w:numbering ${STYLES_NS}><w:numPicBullet w:numPicBulletId="0"><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"/></w:pict></w:numPicBullet><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:lvlPicBulletId w:val="0"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    })
  );

  const firstRefusal = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(await buildDocx({ body: `<w:altChunk r:id="rId9"/><w:sectPr/>` }), "unsupported.docx") },
  ]);
  check("refused merge returns no output", !firstRefusal.ok && !("value" in firstRefusal));

  // =========================================================================
  // HOST MAY RETAIN UNSUPPORTED CONTENT
  // =========================================================================
  const richHost = await buildDocx({
    body: `${paragraph("Rich host", '<w:bookmarkStart w:id="0" w:name="hostBm"/>')}<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>`,
    extraEntries: {
      "word/header1.xml": headerXml,
      "word/footnotes.xml": notesXml("footnotes"),
      "customXml/item1.xml": `<?xml version="1.0"?><root/>`,
    },
    documentRelsExtra: `<Relationship Id="rIdH" Type="${REL_TYPES.header}" Target="header1.xml"/><Relationship Id="rIdF" Type="${REL_TYPES.footnotes}" Target="footnotes.xml"/>`,
    contentTypesExtra: `<Override PartName="/word/header1.xml" ContentType="${CONTENT_TYPES.header}"/><Override PartName="/word/footnotes.xml" ContentType="${CONTENT_TYPES.footnotes}"/>`,
  });
  const richMerge = await mergeDocxDocuments([
    { input: docxFile(richHost, "rich-host.docx") },
    { input: docxFile(beta, "beta.docx") },
  ]);
  check("host with unsupported content merges", richMerge.ok);
  if (richMerge.ok) {
    const entries = (await JSZip.loadAsync(richMerge.value.bytes)).files;
    check("host header part is retained", Boolean(entries["word/header1.xml"]));
    check("host footnotes part is retained", Boolean(entries["word/footnotes.xml"]));
    check("host custom XML part is retained", Boolean(entries["customXml/item1.xml"]));
    check(
      "host bookmark is retained",
      (await readEntryText(richMerge.value.bytes, "word/document.xml")).includes("hostBm")
    );
    check("host relationships resolve", richMerge.value.verification.relationshipsResolved);
    check(
      "host-retaining merge output validates",
      (await validateDocxFile(richMerge.value.bytes, { name: richMerge.value.outputFileName })).ok
    );
  }

  // =========================================================================
  // SECTIONS AND NAMESPACES
  // =========================================================================
  const sectionA = await buildDocx({
    body: `${paragraph("Section A")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`,
  });
  const sectionB = await buildDocx({
    body: `${paragraph("Section B")}<w:sectPr><w:pgSz w:w="15840" w:h="12240"/></w:sectPr>`,
  });
  const sectionC = await buildDocx({
    body: `${paragraph("Section C")}<w:sectPr><w:pgSz w:w="20000" w:h="20000"/></w:sectPr>`,
  });
  const sections = await mergeDocxDocuments([
    { input: docxFile(sectionA, "section-a.docx") },
    { input: docxFile(sectionB, "section-b.docx") },
    { input: docxFile(sectionC, "section-c.docx") },
  ]);
  check("section merge succeeds", sections.ok);
  if (sections.ok) {
    const sectionDocument = await outputDocument(sections.value.bytes);
    const sectionXml = await readEntryText(sections.value.bytes, "word/document.xml");
    check("three sections produce two inline section breaks", inlineSectPrs(sectionDocument) === 2);
    check("three sections produce one body-level sectPr", directSectPrs(sectionDocument).length === 1);
    check("every section geometry survives", ["12240", "15840", "20000"].every((width) => sectionXml.includes(`w:w="${width}"`)));
    const finalSection = directSectPrs(sectionDocument)[0];
    const finalPageSize = finalSection.getElementsByTagNameNS(W, "pgSz")[0];
    check("last source supplies body-level geometry", finalPageSize.getAttributeNS(W, "w") === "20000");
    check("section merge output validates", (await validateDocxFile(sections.value.bytes, { name: sections.value.outputFileName })).ok);
  }

  const noSectPrSource = await buildDocx({ body: paragraph("No section properties") });
  const noSectPr = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(noSectPrSource, "no-sectpr.docx") },
  ]);
  check("source without sectPr merges", noSectPr.ok);
  if (noSectPr.ok) {
    const noSectPrDocument = await outputDocument(noSectPr.value.bytes);
    check("source without sectPr adds no break", noSectPr.value.merged.sectionBreaks === 0);
    check("source without sectPr adds no paragraph", noSectPr.value.merged.paragraphs === 2);
    check("source without sectPr keeps host body sectPr", directSectPrs(noSectPrDocument).length === 1 && inlineSectPrs(noSectPrDocument) === 0);
  }

  const nsHost = await buildDocx({
    body: `${paragraph("NS host")}<w:sectPr/>`,
    documentIgnorable: "w14",
  });
  const nsOther = await buildDocx({
    body: `<w:p xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" w15:paraId="AA"><w:r><w:t>NS other</w:t></w:r></w:p><w:sectPr/>`,
    documentIgnorable: "w14 w15",
    documentRootAttributes: `xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"`,
  });
  const namespaces = await mergeDocxDocuments([
    { input: docxFile(nsHost, "ns-host.docx") },
    { input: docxFile(nsOther, "ns-other.docx") },
  ]);
  check("namespace merge succeeds", namespaces.ok);
  if (namespaces.ok) {
    const root = (await outputDocument(namespaces.value.bytes)).documentElement;
    const ignorable = root.getAttributeNS(MC, "Ignorable") ?? "";
    const tokens = ignorable.split(/\s+/).filter(Boolean);
    check("missing namespace declaration is imported", root.getAttribute("xmlns:w15") === "http://schemas.microsoft.com/office/word/2012/wordml");
    check("mc:Ignorable is unioned", tokens.includes("w14") && tokens.includes("w15"));
    check("mc:Ignorable has no duplicates", new Set(tokens).size === tokens.length);
    check("namespace merge output validates", (await validateDocxFile(namespaces.value.bytes, { name: namespaces.value.outputFileName })).ok);
  }

  // =========================================================================
  // OUTPUT PACKAGE INTEGRITY
  // =========================================================================
  const integrity = await mergeDocxDocuments([
    { input: docxFile(richHost, "rich-host.docx") },
    { input: docxFile(sectionB, "section-b.docx") },
  ]);
  check("integrity merge succeeds", integrity.ok);
  if (integrity.ok) {
    const outputZip = await JSZip.loadAsync(integrity.value.bytes);
    const outputEntries = Object.values(outputZip.files).filter((entry) => !entry.dir).map((entry) => entry.name);
    const manifest = parseContentTypes(await readEntryText(integrity.value.bytes, "[Content_Types].xml"));
    check("every output entry has a content type", outputEntries.every((entry) => isPartTyped(manifest, entry)));
    check("content types declare no missing part", [...manifest.overrides.keys()].every((part) => outputEntries.includes(part)));
    check("verification reports complete content types", integrity.value.verification.contentTypesComplete);

    const relsXml = await readEntryText(integrity.value.bytes, "word/_rels/document.xml.rels");
    const relIds = [...relsXml.matchAll(/Id="([^"]+)"/g)].map((match) => match[1]);
    check("relationship IDs are unique", new Set(relIds).size === relIds.length);
    check("verification reports resolved relationships", integrity.value.verification.relationshipsResolved);
    check("verification reports unique IDs", integrity.value.verification.idsUnique);
  }

  // =========================================================================
  // COMBINED SIZE LIMIT
  // =========================================================================
  const padding = "x".repeat(40000);
  const paddedA = await buildDocx({
    body: `${paragraph("Padded A")}<w:sectPr/>`,
    extraEntries: { "word/pad1.xml": padding },
  });
  const paddedB = await buildDocx({
    body: `${paragraph("Padded B")}<w:sectPr/>`,
    extraEntries: { "word/pad2.xml": padding },
  });
  const combinedLimits = { ...DEFAULT_DOCX_LIMITS, maxUncompressedBytes: 70000 };
  const combinedSize = await mergeDocxDocuments(
    [
      { input: docxFile(paddedA, "padded-a.docx") },
      { input: docxFile(paddedB, "padded-b.docx") },
    ],
    { limits: combinedLimits }
  );
  check("combined uncompressed size limit is enforced", !combinedSize.ok && resultCode(combinedSize) === "UNSUPPORTED_STRUCTURE");
  check(
    "combined size refusal mentions expansion",
    !combinedSize.ok && (combinedSize.error.detail ?? "").includes("limit")
  );

  // =========================================================================
  // REAL WORD FILES
  // =========================================================================
  const realPaths = [
    "/Users/pranav/Documents/id proof/pranav.docx",
    "/Users/pranav/Downloads/Function Point Calculation.docx",
    "/Users/pranav/Downloads/knowi report.docx",
  ].filter((path) => fs.existsSync(path));

  if (realPaths.length < 2) {
    console.log("SKIP  not enough real Word files present on this machine");
  } else {
    const [firstReal, secondReal] = realPaths;
    const firstBytes = new Uint8Array(fs.readFileSync(firstReal));
    const secondBytes = new Uint8Array(fs.readFileSync(secondReal));
    const firstName = firstReal.split("/").pop() as string;
    const secondName = secondReal.split("/").pop() as string;

    const realMerge = await mergeDocxDocuments([
      { input: firstBytes, name: firstName, mimeType: DOCX_MIME_TYPE },
      { input: secondBytes, name: secondName, mimeType: DOCX_MIME_TYPE },
    ]);
    check(`real files merge: ${firstName} + ${secondName}`, realMerge.ok);
    if (realMerge.ok) {
      check("real merge output validates", (await validateDocxFile(realMerge.value.bytes, { name: realMerge.value.outputFileName })).ok);
      check("real merge verification passes structurally", realMerge.value.verification.packageValid && realMerge.value.verification.documentBodyValid && realMerge.value.verification.paragraphOrderPreserved);
      check("real merge keeps paragraph count", realMerge.value.merged.paragraphs === countParagraphs(await outputDocument(realMerge.value.bytes)));
      check("real merge keeps table count", realMerge.value.merged.tables === countTables(await outputDocument(realMerge.value.bytes)));
    }
    check("real input bytes remain unchanged", firstBytes.every((byte, index) => byte === new Uint8Array(fs.readFileSync(firstReal))[index]) && secondBytes.every((byte, index) => byte === new Uint8Array(fs.readFileSync(secondReal))[index]));

    const knowiPath = realPaths.find((path) => path.endsWith("knowi report.docx"));
    const plainPath = realPaths.find((path) => !path.endsWith("knowi report.docx"));
    if (knowiPath && plainPath) {
      const knowiBytes = new Uint8Array(fs.readFileSync(knowiPath));
      const plainBytes = new Uint8Array(fs.readFileSync(plainPath));
      const knowiName = knowiPath.split("/").pop() as string;
      const plainName = plainPath.split("/").pop() as string;

      const knowiAsHost = await mergeDocxDocuments([
        { input: knowiBytes, name: knowiName, mimeType: DOCX_MIME_TYPE },
        { input: plainBytes, name: plainName, mimeType: DOCX_MIME_TYPE },
      ]);
      check("real file with headers is accepted as host", knowiAsHost.ok);
      if (knowiAsHost.ok) {
        const entries = (await JSZip.loadAsync(knowiAsHost.value.bytes)).files;
        check("real host keeps its header part", Object.keys(entries).some((entry) => /^word\/header/.test(entry)));
        check("real host keeps its custom XML part", Object.keys(entries).some((entry) => /^customXml\//.test(entry)));
      }

      const knowiAsSource = await mergeDocxDocuments([
        { input: plainBytes, name: plainName, mimeType: DOCX_MIME_TYPE },
        { input: knowiBytes, name: knowiName, mimeType: DOCX_MIME_TYPE },
      ]);
      check("real file with relationship content is refused as non-host", !knowiAsSource.ok && resultCode(knowiAsSource) === "UNSUPPORTED_STRUCTURE");
      check(
        "real non-host refusal emits MERGE_CONTENT_UNSUPPORTED",
        !knowiAsSource.ok && knowiAsSource.warnings.some((warning) => warning.code === "MERGE_CONTENT_UNSUPPORTED")
      );
    }
  }

  // __MORE_TESTS__

  // =========================================================================
  // PHASE 9.2 — EMBEDDED IMAGES
  // =========================================================================
  const pngBytesA = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const pngBytesB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6]);
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);

  const imageSource = await buildDocx({
    body: `${paragraph("Image source")}${drawingParagraph("rIdImgA")}<w:sectPr/>`,
    extraEntries: { "word/media/image1.png": pngBytesA },
    documentRelsExtra: imageRelationship("rIdImgA", "media/image1.png"),
  });
  const singleImage = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(imageSource, "image-a.docx") },
  ]);
  check("single embedded image merges", singleImage.ok);
  if (singleImage.ok) {
    const entries = (await JSZip.loadAsync(singleImage.value.bytes)).files;
    check("imported media part exists", Boolean(entries["word/media/image1.png"]));
    check(
      "imported media bytes are preserved",
      bytesEqual(await readEntry(singleImage.value.bytes, "word/media/image1.png"), pngBytesA)
    );
    const documentXml = await readEntryText(singleImage.value.bytes, "word/document.xml");
    const installedEmbed = /r:embed="([^"]+)"/.exec(documentXml)?.[1];
    const outputRels = parseRelationships(
      await readEntryText(singleImage.value.bytes, "word/_rels/document.xml.rels"),
      "output rels"
    );
    const imageRel = outputRels.find((relationship) => relationship.id === installedEmbed);
    check(
      "image relationship is remapped into the document scope",
      Boolean(installedEmbed) &&
        installedEmbed !== "rIdImgA" &&
        imageRel?.type === REL_TYPES.image &&
        imageRel?.target === "media/image1.png" &&
        imageRel?.targetMode === null
    );
    check(
      "image verification and counts are reported",
      singleImage.value.verification.mediaPreserved &&
        singleImage.value.verification.relationshipsResolved &&
        singleImage.value.merged.media === 1 &&
        singleImage.value.sources[1].mediaImported === 1
    );
    check(
      "image merge output validates",
      (await validateDocxFile(singleImage.value.bytes, { name: singleImage.value.outputFileName })).ok
    );
  }

  // Multiple images, a filename collision, a second extension and a host collision.
  const imageSourceB = await buildDocx({
    body: `${paragraph("Second image")}${drawingParagraph("rIdImgB")}<w:sectPr/>`,
    extraEntries: { "word/media/image1.png": pngBytesB },
    documentRelsExtra: imageRelationship("rIdImgB", "media/image1.png"),
  });
  const jpegSource = await buildDocx({
    body: `${paragraph("JPEG image")}${drawingParagraph("rIdJpeg")}<w:sectPr/>`,
    extraEntries: { "word/media/photo.jpeg": jpegBytes },
    contentTypesExtra: `<Default Extension="jpeg" ContentType="image/jpeg"/>`,
    documentRelsExtra: imageRelationship("rIdJpeg", "media/photo.jpeg"),
  });
  const multiImage = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(imageSource, "image-a.docx") },
    { input: docxFile(imageSourceB, "image-b.docx") },
    { input: docxFile(jpegSource, "jpeg-source.docx") },
  ]);
  check("multiple images merge", multiImage.ok);
  if (multiImage.ok) {
    const entries = (await JSZip.loadAsync(multiImage.value.bytes)).files;
    check(
      "colliding media filenames get deterministic unique names",
      Boolean(entries["word/media/image1.png"]) && Boolean(entries["word/media/image1-2.png"])
    );
    check(
      "colliding media parts keep distinct bytes",
      bytesEqual(await readEntry(multiImage.value.bytes, "word/media/image1.png"), pngBytesA) &&
        bytesEqual(await readEntry(multiImage.value.bytes, "word/media/image1-2.png"), pngBytesB)
    );
    check(
      "a second image extension is imported",
      Boolean(entries["word/media/photo.jpeg"]) &&
        bytesEqual(await readEntry(multiImage.value.bytes, "word/media/photo.jpeg"), jpegBytes)
    );
    const manifest = parseContentTypes(
      await readEntryText(multiImage.value.bytes, "[Content_Types].xml")
    );
    check("missing image extension default is registered", manifest.defaults.get("jpeg") === "image/jpeg");
    const embeds = [...(await readEntryText(multiImage.value.bytes, "word/document.xml")).matchAll(/r:embed="([^"]+)"/g)].map((match) => match[1]);
    check("every image uses a distinct relationship", new Set(embeds).size === 3);
    check(
      "multiple image counts are reported",
      multiImage.value.merged.media === 3 &&
        multiImage.value.sources.every((source, index) => index === 0 || source.mediaImported === 1)
    );
    check(
      "multiple image output validates",
      (await validateDocxFile(multiImage.value.bytes, { name: multiImage.value.outputFileName })).ok
    );
  }

  const hostWithMedia = await buildDocx({
    body: `${paragraph("Host media")}<w:sectPr/>`,
    extraEntries: { "word/media/image1.png": pngBytesB },
  });
  const hostCollision = await mergeDocxDocuments([
    { input: docxFile(hostWithMedia, "host-media.docx") },
    { input: docxFile(imageSource, "image-a.docx") },
  ]);
  check("import avoids a host media filename collision", hostCollision.ok);
  if (hostCollision.ok) {
    const entries = (await JSZip.loadAsync(hostCollision.value.bytes)).files;
    check(
      "host media is retained and imported media is renamed",
      bytesEqual(await readEntry(hostCollision.value.bytes, "word/media/image1.png"), pngBytesB) &&
        Boolean(entries["word/media/image1-2.png"])
    );
    check(
      "host media collision output validates",
      (await validateDocxFile(hostCollision.value.bytes, { name: hostCollision.value.outputFileName })).ok
    );
  }

  // Anchored drawings use the same relationship path as inline drawings.
  const anchoredSource = await buildDocx({
    body: `${paragraph("Anchored image")}${drawingParagraph("rIdAnchor", "anchor")}<w:sectPr/>`,
    extraEntries: { "word/media/anchored.png": pngBytesA },
    documentRelsExtra: imageRelationship("rIdAnchor", "media/anchored.png"),
  });
  const anchored = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(anchoredSource, "anchored.docx") },
  ]);
  check("anchored drawing merges", anchored.ok);
  if (anchored.ok) {
    const documentXml = await readEntryText(anchored.value.bytes, "word/document.xml");
    check("anchored drawing keeps its anchor structure", documentXml.includes("wp:anchor"));
    check(
      "anchored drawing reference is remapped",
      /r:embed="rId\d+"/.test(documentXml) && !documentXml.includes('r:embed="rIdAnchor"')
    );
    check("anchored drawing output validates", (await validateDocxFile(anchored.value.bytes, { name: anchored.value.outputFileName })).ok);
  }

  // Refusals: missing media, bad content type, external image, malformed relationship.
  await expectUnsupported(
    "image with a missing media part",
    await buildDocx({
      body: `${drawingParagraph("rIdMissing")}<w:sectPr/>`,
      documentRelsExtra: imageRelationship("rIdMissing", "media/missing.png"),
    })
  );

  await expectUnsupported(
    "image with a non-image content type",
    await buildDocx({
      body: `${drawingParagraph("rIdBadType")}<w:sectPr/>`,
      extraEntries: { "word/media/image1.bin": pngBytesA },
      contentTypesExtra: `<Default Extension="bin" ContentType="application/octet-stream"/>`,
      documentRelsExtra: imageRelationship("rIdBadType", "media/image1.bin"),
    })
  );

  await expectUnsupported(
    "external image relationship",
    await buildDocx({
      body: `${drawingParagraph("rIdRemote")}<w:sectPr/>`,
      documentRelsExtra: imageRelationship("rIdRemote", "https://example.com/remote.png", true),
    })
  );

  // =========================================================================
  // PHASE 9.2 — EXTERNAL HYPERLINKS
  // =========================================================================
  const linkUrl = "https://example.com/report?year=2026&unit=a%20b";
  const linkUrlXml = linkUrl.replace(/&/g, "&amp;");
  const linkSource = await buildDocx({
    body: `${paragraph("Read ")}<w:hyperlink r:id="rIdLinkA"><w:r><w:t>the report</w:t></w:r></w:hyperlink><w:sectPr/>`,
    documentRelsExtra: hyperlinkRelationship("rIdLinkA", linkUrlXml),
  });
  const singleLink = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(linkSource, "link-source.docx") },
  ]);
  check("external hyperlink merges", singleLink.ok);
  if (singleLink.ok) {
    const documentXml = await readEntryText(singleLink.value.bytes, "word/document.xml");
    const installedId = /<w:hyperlink[^>]*r:id="([^"]+)"/.exec(documentXml)?.[1];
    const outputRels = parseRelationships(
      await readEntryText(singleLink.value.bytes, "word/_rels/document.xml.rels"),
      "output rels"
    );
    const installed = outputRels.find((relationship) => relationship.id === installedId);
    check(
      "hyperlink target URL is preserved exactly",
      installed?.type === REL_TYPES.hyperlink &&
        installed?.target === linkUrl &&
        installed?.targetMode === "External"
    );
    check("hyperlink text is preserved", documentXml.includes("the report"));
    check(
      "hyperlink verification and counts are reported",
      singleLink.value.verification.hyperlinksPreserved &&
        singleLink.value.merged.hyperlinks === 1 &&
        singleLink.value.sources[1].hyperlinksImported === 1
    );
    check(
      "hyperlink merge output validates",
      (await validateDocxFile(singleLink.value.bytes, { name: singleLink.value.outputFileName })).ok
    );
  }

  const multiLinkSource = await buildDocx({
    body: `<w:p><w:hyperlink r:id="rIdLinkA"><w:r><w:t>first</w:t></w:r></w:hyperlink><w:r><w:t> and </w:t></w:r><w:hyperlink r:id="rIdLinkB"><w:r><w:t>second</w:t></w:r></w:hyperlink></w:p><w:sectPr/>`,
    documentRelsExtra: `${hyperlinkRelationship("rIdLinkA", "https://example.com/one")}${hyperlinkRelationship("rIdLinkB", "https://example.com/two")}`,
  });
  const multiLink = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(multiLinkSource, "links.docx") },
  ]);
  check("multiple hyperlinks merge", multiLink.ok);
  if (multiLink.ok) {
    const outputRels = parseRelationships(
      await readEntryText(multiLink.value.bytes, "word/_rels/document.xml.rels"),
      "output rels"
    ).filter((relationship) => relationship.type === REL_TYPES.hyperlink);
    check(
      "each hyperlink gets its own external relationship",
      outputRels.length === 2 &&
        outputRels.every((relationship) => relationship.targetMode === "External") &&
        outputRels.map((relationship) => relationship.target).sort().join(",") === "https://example.com/one,https://example.com/two"
    );
    check("multiple hyperlink count is reported", multiLink.value.merged.hyperlinks === 2);
  }

  // The source's rId1 collides with the host's styles relationship ID.
  const collisionLinkSource = await buildDocx({
    body: `<w:hyperlink r:id="rId1"><w:r><w:t>collision</w:t></w:r></w:hyperlink><w:sectPr/>`,
    styles: null,
    numbering: null,
    documentRelsExtra: hyperlinkRelationship("rId1", "https://example.com/collision"),
  });
  const collisionLink = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(collisionLinkSource, "collision-link.docx") },
  ]);
  check("hyperlink relationship ID collision merges", collisionLink.ok);
  if (collisionLink.ok) {
    const outputRels = parseRelationships(
      await readEntryText(collisionLink.value.bytes, "word/_rels/document.xml.rels"),
      "output rels"
    );
    const stylesRel = outputRels.find((relationship) => relationship.type === REL_TYPES.styles);
    const hyperlinkRel = outputRels.find((relationship) => relationship.type === REL_TYPES.hyperlink);
    check(
      "host styles relationship keeps its ID",
      stylesRel?.id === "rId1" && stylesRel?.target === "styles.xml"
    );
    check(
      "colliding hyperlink gets a fresh relationship ID",
      Boolean(hyperlinkRel) && hyperlinkRel?.id !== "rId1" && hyperlinkRel?.target === "https://example.com/collision"
    );
    check("relationship IDs stay unique after a collision", new Set(outputRels.map((relationship) => relationship.id)).size === outputRels.length);
  }

  await expectUnsupported(
    "hyperlink without an external target mode",
    await buildDocx({
      body: `<w:hyperlink r:id="rIdInternal"><w:r><w:t>Internal</w:t></w:r></w:hyperlink><w:sectPr/>`,
      documentRelsExtra: hyperlinkRelationship("rIdInternal", "target-part.xml", false),
    })
  );

  // =========================================================================
  // PHASE 9.2 — BOOKMARKS AND INTERNAL REFERENCES
  // =========================================================================
  const hostBookmarked = await buildDocx({
    body: `${bookmarkParagraph(0, "hostBm", "Host bookmark")}<w:sectPr/>`,
  });
  const bookmarkedSource = await buildDocx({
    body: `${bookmarkParagraph(0, "importedBm", "Imported bookmark")}<w:sectPr/>`,
  });
  const bookmarkMerge = await mergeDocxDocuments([
    { input: docxFile(hostBookmarked, "bookmark-host.docx") },
    { input: docxFile(bookmarkedSource, "bookmark-source.docx") },
  ]);
  check("bookmarks merge", bookmarkMerge.ok);
  if (bookmarkMerge.ok) {
    const document = await outputDocument(bookmarkMerge.value.bytes);
    const starts = elementsOf(document, "bookmarkStart");
    const ends = elementsOf(document, "bookmarkEnd");
    const startIds = starts.map((start) => Number(start.getAttributeNS(W, "id")));
    const endIds = ends.map((end) => Number(end.getAttributeNS(W, "id")));
    check(
      "bookmark names are preserved without a collision",
      starts.map((start) => start.getAttributeNS(W, "name")).join(",") === "hostBm,importedBm"
    );
    check(
      "imported bookmark IDs stay unique",
      new Set(startIds).size === 2 && startIds.every((id) => Number.isInteger(id))
    );
    check(
      "bookmark start and end boundaries match",
      startIds.slice().sort().join(",") === endIds.slice().sort().join(",")
    );
    check(
      "bookmark verification and counts are reported",
      bookmarkMerge.value.verification.bookmarksValid &&
        bookmarkMerge.value.merged.bookmarks === 1
    );
    check(
      "bookmark merge output validates",
      (await validateDocxFile(bookmarkMerge.value.bytes, { name: bookmarkMerge.value.outputFileName })).ok
    );
  }

  const collisionBookmarkSource = await buildDocx({
    body: `${bookmarkParagraph(7, "hostBm", "Colliding bookmark")}${anchorHyperlink("hostBm", "Jump")}<w:p><w:fldSimple w:instr="REF hostBm \\h"><w:r><w:t>Field</w:t></w:r></w:fldSimple></w:p><w:sectPr/>`,
  });
  const bookmarkCollision = await mergeDocxDocuments([
    { input: docxFile(hostBookmarked, "bookmark-host.docx") },
    { input: docxFile(collisionBookmarkSource, "bookmark-collision.docx") },
  ]);
  check("bookmark name collision merges", bookmarkCollision.ok);
  if (bookmarkCollision.ok) {
    const document = await outputDocument(bookmarkCollision.value.bytes);
    const names = elementsOf(document, "bookmarkStart").map((start) => start.getAttributeNS(W, "name"));
    const hyperlinks = elementsOf(document, "hyperlink");
    const fields = elementsOf(document, "fldSimple");
    check(
      "colliding bookmark name is renamed deterministically",
      names.includes("hostBm") && names.includes("hostBm_2")
    );
    check(
      "internal anchor follows the renamed bookmark",
      hyperlinks.length === 1 && hyperlinks[0].getAttributeNS(W, "anchor") === "hostBm_2"
    );
    check(
      "field reference follows the renamed bookmark",
      fields.length === 1 && (fields[0].getAttributeNS(W, "instr") ?? "").includes("hostBm_2")
    );
    check(
      "renamed bookmark count is reported",
      bookmarkCollision.value.sources[1].bookmarksRenumbered === 1 &&
        bookmarkCollision.value.verification.bookmarksValid
    );
    check(
      "bookmark collision output validates",
      (await validateDocxFile(bookmarkCollision.value.bytes, { name: bookmarkCollision.value.outputFileName })).ok
    );
  }

  const secondBookmarked = await buildDocx({
    body: `${bookmarkParagraph(0, "importedBm", "Another imported bookmark")}<w:sectPr/>`,
  });
  const twoBookmarkSources = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(bookmarkedSource, "bookmark-one.docx") },
    { input: docxFile(secondBookmarked, "bookmark-two.docx") },
  ]);
  check("bookmarks from multiple documents merge", twoBookmarkSources.ok);
  if (twoBookmarkSources.ok) {
    const names = elementsOf(await outputDocument(twoBookmarkSources.value.bytes), "bookmarkStart").map((start) => start.getAttributeNS(W, "name"));
    check(
      "collisions between imported documents are renamed in order",
      names.join(",") === "importedBm,importedBm_2"
    );
    check("multiple bookmark count is reported", twoBookmarkSources.value.merged.bookmarks === 2);
  }

  await expectUnsupported(
    "unresolved bookmark anchor",
    await buildDocx({
      body: `${anchorHyperlink("doesNotExist", "Dangling")}<w:sectPr/>`,
    })
  );

  const crossAnchorFirst = await buildDocx({
    body: `${bookmarkParagraph(0, "sharedBm", "Shared bookmark")}<w:sectPr/>`,
  });
  const crossAnchorSecond = await buildDocx({
    body: `${anchorHyperlink("sharedBm", "Ambiguous jump")}<w:sectPr/>`,
  });
  const crossAnchor = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(crossAnchorFirst, "cross-anchor-one.docx") },
    { input: docxFile(crossAnchorSecond, "cross-anchor-two.docx") },
  ]);
  check(
    "an anchor that only matches another imported document is refused",
    !crossAnchor.ok && resultCode(crossAnchor) === "UNSUPPORTED_STRUCTURE"
  );
  check(
    "cross-document anchor refusal emits MERGE_CONTENT_UNSUPPORTED",
    !crossAnchor.ok && crossAnchor.warnings.some((warning) => warning.code === "MERGE_CONTENT_UNSUPPORTED")
  );

  const splitFieldSource = await buildDocx({
    body: `${bookmarkParagraph(3, "hostBm", "Split field bookmark")}<w:p><w:r><w:instrText xml:space="preserve">REF host</w:instrText></w:r><w:r><w:instrText xml:space="preserve">Bm \\h</w:instrText></w:r></w:p><w:sectPr/>`,
  });
  const splitField = await mergeDocxDocuments([
    { input: docxFile(hostBookmarked, "bookmark-host.docx") },
    { input: docxFile(splitFieldSource, "split-field.docx") },
  ]);
  check(
    "a renamed bookmark split across field runs is refused",
    !splitField.ok && resultCode(splitField) === "UNSUPPORTED_STRUCTURE"
  );
  check(
    "split field refusal emits MERGE_CONTENT_UNSUPPORTED",
    !splitField.ok && splitField.warnings.some((warning) => warning.code === "MERGE_CONTENT_UNSUPPORTED")
  );

  // =========================================================================
  // PHASE 9.2 — CONTENT TYPES, NAMESPACES AND PACKAGE SCOPE
  // =========================================================================
  const conflictingTypeSource = await buildDocx({
    body: `${drawingParagraph("rIdCustom")}<w:sectPr/>`,
    extraEntries: { "word/media/image1.png": pngBytesA },
    contentTypesExtra: `<Override PartName="/word/media/image1.png" ContentType="image/x-custom-png"/>`,
    documentRelsExtra: imageRelationship("rIdCustom", "media/image1.png"),
  });
  const conflictingType = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(conflictingTypeSource, "custom-type.docx") },
  ]);
  check("an imported part type that differs from the host default merges", conflictingType.ok);
  if (conflictingType.ok) {
    const manifest = parseContentTypes(
      await readEntryText(conflictingType.value.bytes, "[Content_Types].xml")
    );
    check(
      "a part-level override preserves the imported image type",
      manifest.overrides.get("word/media/image1.png") === "image/x-custom-png"
    );
    check(
      "the host default declaration is left intact",
      manifest.defaults.get("png") === "image/png"
    );
    check(
      "content-type override output validates",
      (await validateDocxFile(conflictingType.value.bytes, { name: conflictingType.value.outputFileName })).ok
    );
  }

  const conflictHost = await buildDocx({
    body: `${paragraph("Conflicting prefix host")}<w:sectPr/>`,
    documentRootAttributes: `xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"`,
  });
  const conflictSource = await buildDocx({
    body: `<w:p xmlns:w15="urn:example:conflicting" w15:paraId="BB"><w:r><w:t>Conflicting prefix</w:t></w:r></w:p><w:sectPr/>`,
    documentRootAttributes: `xmlns:w15="urn:example:conflicting"`,
    documentIgnorable: "w14 w15",
  });
  const conflictingNamespace = await mergeDocxDocuments([
    { input: docxFile(conflictHost, "conflict-host.docx") },
    { input: docxFile(conflictSource, "conflict-source.docx") },
  ]);
  check("a conflicting namespace prefix merges", conflictingNamespace.ok);
  if (conflictingNamespace.ok) {
    const outputDocumentXml = await readEntryText(conflictingNamespace.value.bytes, "word/document.xml");
    const reparsed = parseXml(outputDocumentXml, "merged document").document;
    const root = reparsed.documentElement;
    const importedParagraph = elementsOf(reparsed, "p").find(
      (element) => element.getAttributeNodeNS("urn:example:conflicting", "paraId") !== null
    );
    check(
      "the host prefix declaration keeps its original meaning",
      root.getAttribute("xmlns:w15") === "http://schemas.microsoft.com/office/word/2012/wordml"
    );
    check(
      "the imported attribute keeps its own namespace",
      importedParagraph?.getAttributeNodeNS("urn:example:conflicting", "paraId")?.value === "BB"
    );
    check("namespace conflict verification passes", conflictingNamespace.value.verification.namespacesValid);
    check(
      "namespace conflict output validates",
      (await validateDocxFile(conflictingNamespace.value.bytes, { name: conflictingNamespace.value.outputFileName })).ok
    );
  }

  const undeclaredIgnorable = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    {
      input: docxFile(
        await buildDocx({
          body: `${paragraph("Undeclared ignorable")}<w:sectPr/>`,
          documentIgnorable: "w14 w99",
        }),
        "undeclared-ignorable.docx"
      ),
    },
  ]);
  check("an undeclared mc:Ignorable token is dropped", undeclaredIgnorable.ok);
  if (undeclaredIgnorable.ok) {
    const root = (await outputDocument(undeclaredIgnorable.value.bytes)).documentElement;
    const tokens = (root.getAttributeNS(MC, "Ignorable") ?? "").split(/\s+/).filter(Boolean);
    check(
      "mc:Ignorable only lists declared prefixes",
      tokens.includes("w14") && !tokens.includes("w99")
    );
    check(
      "filtered mc:Ignorable output validates",
      (await validateDocxFile(undeclaredIgnorable.value.bytes, { name: undeclaredIgnorable.value.outputFileName })).ok
    );
  }

  // Relationship IDs must never leak across .rels scopes.
  const scopeMerge = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(imageSource, "image-a.docx") },
    { input: docxFile(linkSource, "link-source.docx") },
  ]);
  check("mixed relationship content merges", scopeMerge.ok);
  if (scopeMerge.ok) {
    const relsParts = Object.keys((await JSZip.loadAsync(scopeMerge.value.bytes)).files).filter((entry) => entry.endsWith(".rels"));
    check(
      "imported relationships only use the document relationship scope",
      relsParts.sort().join(",") === "_rels/.rels,word/_rels/document.xml.rels"
    );
    const documentXml = await readEntryText(scopeMerge.value.bytes, "word/document.xml");
    const outputRels = parseRelationships(
      await readEntryText(scopeMerge.value.bytes, "word/_rels/document.xml.rels"),
      "output rels"
    );
    const referenced = new Set([...documentXml.matchAll(/r:(?:embed|id)="([^"]+)"/g)].map((match) => match[1]));
    check(
      "every body relationship reference resolves in the document scope",
      [...referenced].every((id) => outputRels.some((relationship) => relationship.id === id))
    );
    check(
      "mixed relationship output validates",
      (await validateDocxFile(scopeMerge.value.bytes, { name: scopeMerge.value.outputFileName })).ok
    );
    check("mixed relationship verification passes", scopeMerge.value.verification.relationshipsResolved && scopeMerge.value.verification.mediaPreserved && scopeMerge.value.verification.hyperlinksPreserved);
  }

  // Original source bytes stay unchanged after relationship import.
  const immutableSource = docxFile(
    await buildDocx({
      body: `${drawingParagraph("rIdImmutable")}${bookmarkParagraph(0, "immutableBm", "Immutable")}<w:p><w:hyperlink r:id="rIdImmutableLink"><w:r><w:t>immutable link</w:t></w:r></w:hyperlink></w:p><w:sectPr/>`,
      extraEntries: { "word/media/immutable.png": pngBytesA },
      documentRelsExtra: `${imageRelationship("rIdImmutable", "media/immutable.png")}${hyperlinkRelationship("rIdImmutableLink", "https://example.com/immutable")}`,
    }),
    "immutable-source.docx"
  );
  const immutableSnapshot = new Uint8Array(await immutableSource.arrayBuffer());
  const immutableSize = immutableSource.size;
  const immutableMerge = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: immutableSource },
  ]);
  const immutableAfter = new Uint8Array(await immutableSource.arrayBuffer());
  check("relationship source merge succeeds", immutableMerge.ok);
  check(
    "relationship source bytes are unchanged",
    bytesEqual(immutableSnapshot, immutableAfter)
  );
  check(
    "relationship source metadata is unchanged",
    immutableSource.size === immutableSize && immutableSource.name === "immutable-source.docx"
  );
  check(
    "input immutability is reported",
    immutableMerge.ok && immutableMerge.value.verification.inputsUnchanged
  );

  // =========================================================================
  // PHASE 9.3 — HARDENING REGRESSIONS
  // =========================================================================

  // Optional parts are read after validation but before the merge pipeline. A corrupt optional
  // part has to come back through the result type, not as a rejected promise.
  const corruptStylesSource = await buildDocx({
    body: `${paragraph("Corrupt styles part")}<w:sectPr/>`,
    styles: null,
    extraEntries: { "word/styles.xml": new Uint8Array([0xff, 0xfe, 0x00, 0x80]) },
    contentTypesExtra: `<Override PartName="/word/styles.xml" ContentType="${CONTENT_TYPES.styles}"/>`,
  });
  let corruptStylesThrew = false;
  let corruptStylesResult: Awaited<ReturnType<typeof mergeDocxDocuments>> | null = null;
  try {
    corruptStylesResult = await mergeDocxDocuments([
      { input: docxFile(alpha, "alpha.docx") },
      { input: docxFile(corruptStylesSource, "corrupt-styles.docx") },
    ]);
  } catch {
    corruptStylesThrew = true;
  }
  check("a corrupt optional part never rejects the public promise", !corruptStylesThrew);
  check(
    "a corrupt optional part returns a typed CORRUPTED_PACKAGE failure",
    !corruptStylesThrew &&
      corruptStylesResult !== null &&
      !corruptStylesResult.ok &&
      resultCode(corruptStylesResult) === "CORRUPTED_PACKAGE"
  );
  check(
    "a corrupt optional part produces no output",
    !corruptStylesThrew && corruptStylesResult !== null && !("value" in corruptStylesResult)
  );

  const corruptManifestZip = await JSZip.loadAsync(
    await buildDocx({ body: `${paragraph("Corrupt manifest")}<w:sectPr/>` })
  );
  corruptManifestZip.file("[Content_Types].xml", new Uint8Array([0xff, 0xfe, 0x00, 0x81]));
  const corruptManifestSource = await corruptManifestZip.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });
  const corruptManifest = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(corruptManifestSource, "corrupt-manifest.docx") },
  ]);
  check(
    "a non-UTF-8 content-types manifest is a typed failure",
    !corruptManifest.ok && resultCode(corruptManifest) === "CORRUPTED_PACKAGE"
  );
  check(
    "a non-UTF-8 content-types manifest produces no output",
    !("value" in corruptManifest)
  );

  // Two different files may legitimately share a name. Media deduplication must stay scoped to
  // one source, or the second source silently shows the first source's image bytes.
  const sameNameSourceA = await buildDocx({
    body: `${paragraph("Same name A")}${drawingParagraph("rIdSameA")}<w:sectPr/>`,
    extraEntries: { "word/media/image1.png": pngBytesA },
    documentRelsExtra: imageRelationship("rIdSameA", "media/image1.png"),
  });
  const sameNameSourceB = await buildDocx({
    body: `${paragraph("Same name B")}${drawingParagraph("rIdSameB")}<w:sectPr/>`,
    extraEntries: { "word/media/image1.png": pngBytesB },
    documentRelsExtra: imageRelationship("rIdSameB", "media/image1.png"),
  });
  const sameNameMerge = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(sameNameSourceA, "duplicate-name.docx") },
    { input: docxFile(sameNameSourceB, "duplicate-name.docx") },
  ]);
  check("sources that share a file name merge", sameNameMerge.ok);
  if (sameNameMerge.ok) {
    const mediaEntries = Object.keys((await JSZip.loadAsync(sameNameMerge.value.bytes)).files)
      .filter((entry) => entry.startsWith("word/media/") && !entry.endsWith("/"))
      .sort();
    check(
      "same-named sources import two distinct media parts",
      mediaEntries.length === 2
    );
    check(
      "the first same-named source keeps its own image bytes",
      bytesEqual(await readEntry(sameNameMerge.value.bytes, "word/media/image1.png"), pngBytesA)
    );
    check(
      "the second same-named source keeps its own image bytes",
      bytesEqual(await readEntry(sameNameMerge.value.bytes, "word/media/image1-2.png"), pngBytesB)
    );
    check(
      "media counts are attributed to the correct source",
      sameNameMerge.value.merged.media === 2 &&
        sameNameMerge.value.sources[1].mediaImported === 1 &&
        sameNameMerge.value.sources[2].mediaImported === 1
    );
    check(
      "same-name image merge output validates",
      (await validateDocxFile(sameNameMerge.value.bytes, { name: sameNameMerge.value.outputFileName })).ok
    );
  }

  // Rename chains (X -> X_2 while X_2 -> X_2_2) must not rewrite a field reference twice.
  const renameChainHost = await buildDocx({
    body: `${bookmarkParagraph(0, "X", "Host X")}<w:sectPr/>`,
  });
  const renameChainSource = await buildDocx({
    body: `${bookmarkParagraph(0, "X", "First imported")}${bookmarkParagraph(1, "X_2", "Second imported")}<w:p><w:fldSimple w:instr="REF X \\h"><w:r><w:t>Field</w:t></w:r></w:fldSimple></w:p><w:sectPr/>`,
  });
  const renameChain = await mergeDocxDocuments([
    { input: docxFile(renameChainHost, "rename-chain-host.docx") },
    { input: docxFile(renameChainSource, "rename-chain.docx") },
  ]);
  check("chained bookmark renames merge", renameChain.ok);
  if (renameChain.ok) {
    const chainedDocument = await outputDocument(renameChain.value.bytes);
    const chainedNames = elementsOf(chainedDocument, "bookmarkStart").map((start) =>
      start.getAttributeNS(W, "name")
    );
    const chainedFields = elementsOf(chainedDocument, "fldSimple");
    check(
      "chained renames are allocated deterministically",
      chainedNames.join(",") === "X,X_2,X_2_2"
    );
    check(
      "a field reference follows its own bookmark through a rename chain",
      chainedFields.length === 1 &&
        chainedFields[0].getAttributeNS(W, "instr") === "REF X_2 \\h"
    );
    check(
      "rename-chain output validates",
      (await validateDocxFile(renameChain.value.bytes, { name: renameChain.value.outputFileName })).ok
    );
  }

  // Duplicate relationship IDs make target resolution ambiguous and must fail closed.
  const duplicateRelSource = await buildDocx({
    body: `${paragraph("Duplicate relationship")}<w:sectPr/>`,
    documentRelsExtra: `${hyperlinkRelationship("rIdDup", "https://example.com/one")}<Relationship Id="rIdDup" Type="${REL_TYPES.hyperlink}" Target="https://example.com/two" TargetMode="External"/>`,
  });
  const duplicateRel = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: docxFile(duplicateRelSource, "duplicate-rel.docx") },
  ]);
  check(
    "duplicate relationship IDs in a source are rejected",
    !duplicateRel.ok && resultCode(duplicateRel) === "UNSUPPORTED_STRUCTURE"
  );
  check(
    "duplicate relationship IDs produce no output",
    !("value" in duplicateRel)
  );

  // A failed merge must leave its inputs byte-for-byte unchanged too.
  const failureSource = docxFile(
    await buildDocx({ body: `<w:altChunk r:id="rIdFailure"/><w:sectPr/>` }),
    "failure-source.docx"
  );
  const failureSnapshot = new Uint8Array(await failureSource.arrayBuffer());
  const failedMerge = await mergeDocxDocuments([
    { input: docxFile(alpha, "alpha.docx") },
    { input: failureSource },
  ]);
  const failureAfter = new Uint8Array(await failureSource.arrayBuffer());
  check(
    "an unsupported source is refused without output",
    !failedMerge.ok && !("value" in failedMerge)
  );
  check(
    "a failed merge leaves its input unchanged",
    bytesEqual(failureSnapshot, failureAfter)
  );
}

main()
  .then(() => {
    console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
    process.exit(failed ? 1 : 0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
