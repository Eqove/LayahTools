/**
 * DOCX metadata removal tests.
 *
 * Fixtures are built in memory. Real Word files are additionally exercised when they happen to be
 * present on the machine, because a genuine Word package is the only honest test of re-zipping.
 */

import fs from "node:fs";
import JSZip from "jszip";
import { DOCX_MIME_TYPE, WORD_NAMESPACE } from "../src/lib/docx/constants";
import { isDocxError } from "../src/lib/docx/errors";
import { mergeDocxDocuments } from "../src/lib/docx/merge";
import { readDocxMetadata } from "../src/lib/docx/metadata";
import {
  DOCX_CLEANED_FALLBACK_NAME,
  SUPPORTED_METADATA_FIELDS,
  removeSupportedDocxMetadata,
  toCleanedDocxFileName,
} from "../src/lib/docx/remove-metadata";
import { validateDocxFile } from "../src/lib/docx/validate";

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};
const codeOf = (value: unknown) => (isDocxError(value) ? value.code : `not-docx-error:${String(value)}`);
const resultCode = (result: { ok: true } | { ok: false; error: unknown }): string =>
  result.ok ? "ok" : codeOf(result.error);

// =========================================================================
// FIXTURES
// =========================================================================

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>`;

const BODY_TEXT = "Preserved body text";

const documentXml = (bodyText: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}"><w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;

const DOCUMENT = documentXml(BODY_TEXT);

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NAMESPACE}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"/>`;

const CUSTOM = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="SecretCustom"><vt:lpwstr>keep me</vt:lpwstr></property></Properties>`;

const CORE_NS = `xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"`;

const FULL_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties ${CORE_NS}>
  <dc:title>Quarterly Report</dc:title>
  <dc:subject>Finance</dc:subject>
  <dc:creator>Ada Lovelace</dc:creator>
  <dc:description>Draft for review.</dc:description>
  <cp:keywords>finance, draft, q4</cp:keywords>
  <cp:lastModifiedBy>Grace Hopper</cp:lastModifiedBy>
  <cp:revision>7</cp:revision>
  <cp:category>Reports</cp:category>
  <dcterms:created>2026-11-15T10:00:00Z</dcterms:created>
  <dcterms:modified>2026-11-16T08:30:00Z</dcterms:modified>
  <cp:lastPrinted>2026-11-14T09:00:00Z</cp:lastPrinted>
  <cp:contentStatus>Draft</cp:contentStatus>
  <dc:language>en-GB</dc:language>
</cp:coreProperties>`;

const FULL_APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Office Word</Application>
  <AppVersion>16.0000</AppVersion>
  <Company>LayahTools Ltd</Company>
  <Manager>Katherine Johnson</Manager>
  <Pages>12</Pages>
  <Words>3456</Words>
  <Characters>21000</Characters>
  <CharactersWithSpaces>24500</CharactersWithSpaces>
  <Template>Normal.dotm</Template>
  <TotalTime>42</TotalTime>
</Properties>`;

interface Parts {
  core?: string | null;
  app?: string | null;
  /** Extra `docProps/*` entries beyond core/app. */
  custom?: string | null;
  /** Overrides the single paragraph text; used by the merge integration checks. */
  bodyText?: string;
}

const EXTRA_PARTS: Record<string, string | Uint8Array> = {
  "word/styles.xml": STYLES,
  "word/theme/theme1.xml": THEME,
  "word/media/image1.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
  "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
};

async function buildDocx(parts: Parts = {}): Promise<Uint8Array> {
  const entries: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": parts.bodyText === undefined ? DOCUMENT : documentXml(parts.bodyText),
    "docProps/core.xml": FULL_CORE,
    "docProps/app.xml": FULL_APP,
    "docProps/custom.xml": CUSTOM,
    ...EXTRA_PARTS,
  };
  if (parts.core === null) delete entries["docProps/core.xml"];
  else if (parts.core !== undefined) entries["docProps/core.xml"] = parts.core;
  if (parts.app === null) delete entries["docProps/app.xml"];
  else if (parts.app !== undefined) entries["docProps/app.xml"] = parts.app;
  if (parts.custom === null) delete entries["docProps/custom.xml"];
  else if (parts.custom !== undefined) entries["docProps/custom.xml"] = parts.custom;

  const zip = new JSZip();
  for (const [path, value] of Object.entries(entries)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

const docxFile = (bytes: Uint8Array, name = "report.docx") =>
  new File([bytes as BlobPart], name, { type: DOCX_MIME_TYPE, lastModified: 1 });

const readEntry = async (bytes: Uint8Array, path: string): Promise<Uint8Array> =>
  (await JSZip.loadAsync(bytes)).file(path)!.async("uint8array");

const readEntryText = async (bytes: Uint8Array, path: string): Promise<string> =>
  new TextDecoder().decode(await readEntry(bytes, path));

async function main() {
  // =========================================================================
  // 1. ALL SUPPORTED PROPERTIES PRESENT
  // =========================================================================

  const source = await buildDocx();
  const before = await readDocxMetadata(docxFile(source));
  check("precondition: all supported fields are readable", before.ok && SUPPORTED_METADATA_FIELDS.every((field) => before.value[field] !== undefined));
  check("precondition: fixture exposes 17 supported fields", SUPPORTED_METADATA_FIELDS.length === 17);

  // =========================================================================
  // 2. SUCCESSFUL REMOVAL
  // =========================================================================

  const cleaned = await removeSupportedDocxMetadata(docxFile(source));
  check("cleanup succeeds", cleaned.ok);
  if (!cleaned.ok) {
    console.error(cleaned.error);
    console.log(`\n${failed + 1} FAILED`);
    process.exit(1);
  }

  const value = cleaned.value;

  // =========================================================================
  // 19. ACCURATE REPORTING OF REMOVED PROPERTIES
  // =========================================================================

  const removedFields = value.removedProperties.map((property) => property.field).sort();
  check(
    "every supported field is reported as removed",
    removedFields.length === 17 &&
      removedFields.every((field, index) => field === [...SUPPORTED_METADATA_FIELDS].sort()[index])
  );
  check("no unsupported field is reported as removed", removedFields.every((field) => SUPPORTED_METADATA_FIELDS.includes(field)));
  check("empty properties are not reported as removals", value.emptyProperties.length === 0);
  check(
    "core properties are attributed to core.xml",
    value.removedProperties
      .filter((property) => ["title", "subject", "creator", "description", "keywords", "lastModifiedBy", "revision", "category", "created", "modified"].includes(property.field))
      .every((property) => property.part === "docProps/core.xml")
  );
  check(
    "application properties are attributed to app.xml",
    value.removedProperties
      .filter((property) => ["application", "applicationVersion", "company", "manager", "pages", "words", "characters"].includes(property.field))
      .every((property) => property.part === "docProps/app.xml")
  );
  check(
    "element names are reported as written",
    value.removedProperties.find((property) => property.field === "title")?.element === "dc:title" &&
      value.removedProperties.find((property) => property.field === "applicationVersion")?.element === "AppVersion"
  );

  // =========================================================================
  // 16. OUTPUT FILENAME AND MIME TYPE
  // =========================================================================

  check("output filename is suffixed", value.outputFileName === "report-cleaned.docx");
  check("output keeps the original name for reference", value.fileName === "report.docx");
  check("MIME type is the DOCX type", value.mimeType === DOCX_MIME_TYPE);
  check("Blob carries the DOCX MIME type", value.blob.type === DOCX_MIME_TYPE);
  check("Blob size matches the reported byte length", value.blob.size === value.byteLength && value.bytes.length === value.byteLength);
  check("byte length is non-zero", value.byteLength > 0);

  for (const [input, expected] of [
    ["example.docx", "example-cleaned.docx"],
    ["REPORT.DOCX", "REPORT-cleaned.docx"],
    ["my.report.v2.docx", "my.report.v2-cleaned.docx"],
    ["my notes.docx", "my notes-cleaned.docx"],
    ["report", "report-cleaned.docx"],
    [".docx", DOCX_CLEANED_FALLBACK_NAME],
    ["   ", DOCX_CLEANED_FALLBACK_NAME],
  ] as const) {
    check(`filename ${JSON.stringify(input)} -> ${expected}`, toCleanedDocxFileName(input) === expected);
  }

  // =========================================================================
  // 17. OUTPUT REOPENS AND PASSES VALIDATION
  // =========================================================================

  const revalidated = await validateDocxFile(value.bytes, { name: value.outputFileName, mimeType: DOCX_MIME_TYPE });
  check("output passes full DOCX validation", revalidated.ok);
  check("verification reports a valid package", value.verification.packageValid);
  check("verification reports confirmed removal", value.verification.metadataRemovalConfirmed);
  check("verification reports an unchanged document", value.verification.documentContentUnchanged);
  check("verification reports other parts unchanged", value.verification.otherPartsUnchanged);

  // =========================================================================
  // 18. RE-READING THE OUTPUT CONFIRMS REMOVAL
  // =========================================================================

  const after = await readDocxMetadata(value.bytes, { name: value.outputFileName });
  check("cleaned output reads successfully", after.ok);
  if (after.ok) {
    const survivors = SUPPORTED_METADATA_FIELDS.filter((field) => after.value[field] !== undefined);
    check("no supported field survives", survivors.length === 0);
    check("cleaned metadata object is otherwise empty", Object.keys(after.value).length === 0);
  }

  for (const [path, tag] of [
    ["docProps/core.xml", "dc:title"],
    ["docProps/core.xml", "cp:creator"],
    ["docProps/core.xml", "dcterms:created"],
    ["docProps/app.xml", "Application"],
    ["docProps/app.xml", "Pages"],
  ] as const) {
    check(`${tag} element is gone from ${path}`, !(await readEntryText(value.bytes, path)).includes(`<${tag}`));
  }

  // =========================================================================
  // 14. DOCUMENT CONTENT UNCHANGED
  // =========================================================================

  const documentBefore = await readEntryText(source, "word/document.xml");
  const documentAfter = await readEntryText(value.bytes, "word/document.xml");
  check("word/document.xml is byte-identical", documentBefore === documentAfter);
  check("body text survives", documentAfter.includes(BODY_TEXT));

  // =========================================================================
  // 15. UNRELATED PACKAGE ENTRIES UNCHANGED
  // =========================================================================

  for (const path of ["word/styles.xml", "word/theme/theme1.xml", "word/media/image1.png", "word/_rels/document.xml.rels", "[Content_Types].xml", "_rels/.rels"]) {
    const original = await readEntry(source, path);
    const rewritten = await readEntry(value.bytes, path);
    check(`unrelated entry unchanged: ${path}`, original.length === rewritten.length && original.every((byte, index) => byte === rewritten[index]));
  }

  // =========================================================================
  // 20. NO FALSE CLAIM ABOUT UNSUPPORTED METADATA
  // =========================================================================

  check("retained in-part properties are reported", value.retainedProperties.length === 6);
  check(
    "retained properties name the core-part extras",
    ["cp:lastPrinted", "cp:contentStatus", "dc:language"].every((name) =>
      value.retainedProperties.some((property) => property.element === name && property.part === "docProps/core.xml")
    )
  );
  check(
    "retained properties name the app-part extras",
    ["CharactersWithSpaces", "Template", "TotalTime"].every((name) =>
      value.retainedProperties.some((property) => property.element === name && property.part === "docProps/app.xml")
    )
  );
  check(
    "retained properties report whether a value is present",
    value.retainedProperties.filter((property) => property.valuePresent).length === 6
  );
  check(
    "retained values are never exposed",
    !JSON.stringify(value.retainedProperties).includes("2026-11-14") &&
      !JSON.stringify(value.retainedProperties).includes("Normal.dotm")
  );
  check("custom property part is reported as retained", value.retainedParts.includes("docProps/custom.xml"));
  check(
    "partial cleanup produces a METADATA_RETAINED warning",
    value.warnings.some((warning) => warning.code === "METADATA_RETAINED")
  );
  check(
    "custom properties are still present in the output",
    (await readEntryText(value.bytes, "docProps/custom.xml")) === CUSTOM
  );
  check(
    "unsupported in-part properties are still present in the output",
    (await readEntryText(value.bytes, "docProps/core.xml")).includes("cp:lastPrinted")
  );
  check("modified parts are reported", value.modifiedParts.length === 2 && value.modifiedParts.includes("docProps/core.xml"));
  check("cleanup never claims full anonymisation", !/anonymi[sz]ed|complete|all metadata/i.test(JSON.stringify(value.warnings)));

  // =========================================================================
  // 13. ORIGINAL INPUT UNCHANGED
  // =========================================================================

  const guarded = new Uint8Array(await buildDocx());
  const snapshot = Array.from(guarded);
  const guardedFile = docxFile(guarded, "guarded.docx");
  const sizeBefore = guardedFile.size;
  const guardedResult = await removeSupportedDocxMetadata(guardedFile);
  check("original bytes unchanged", snapshot.every((byte, index) => guarded[index] === byte));
  check("original File unchanged", guardedFile.size === sizeBefore && guardedFile.name === "guarded.docx");
  check("output bytes are an independent array", guardedResult.ok && guardedResult.value.bytes !== guarded);

  // =========================================================================
  // 3. MISSING core.xml
  // =========================================================================

  const missingCore = await removeSupportedDocxMetadata(docxFile(await buildDocx({ core: null })));
  check("missing core.xml still cleans app.xml", missingCore.ok && missingCore.value.removedProperties.length === 7);
  check(
    "missing core.xml is reported",
    missingCore.ok && missingCore.warnings.some((warning) => warning.code === "MISSING_METADATA" && warning.detail === "docProps/core.xml")
  );
  check("missing core.xml still produces a valid package", missingCore.ok && (await validateDocxFile(missingCore.value.bytes, { name: "x.docx" })).ok);

  // =========================================================================
  // 4. MISSING app.xml
  // =========================================================================

  const missingApp = await removeSupportedDocxMetadata(docxFile(await buildDocx({ app: null })));
  check("missing app.xml still cleans core.xml", missingApp.ok && missingApp.value.removedProperties.length === 10);
  check(
    "missing app.xml is reported",
    missingApp.ok && missingApp.warnings.some((warning) => warning.code === "MISSING_METADATA" && warning.detail === "docProps/app.xml")
  );

  // =========================================================================
  // 5. BOTH METADATA PARTS MISSING
  // =========================================================================

  const missingBoth = await removeSupportedDocxMetadata(docxFile(await buildDocx({ core: null, app: null })));
  check("both parts missing still succeeds", missingBoth.ok);
  if (missingBoth.ok) {
    check("both parts missing removes nothing", missingBoth.value.removedProperties.length === 0 && missingBoth.value.emptyProperties.length === 0);
    check("both parts missing rewrites nothing", missingBoth.value.modifiedParts.length === 0);
    check(
      "both missing parts are reported",
      missingBoth.warnings.filter((warning) => warning.code === "MISSING_METADATA").length === 2
    );
    check("output is still a valid package", (await validateDocxFile(missingBoth.value.bytes, { name: "x.docx" })).ok);
    check(
      "document content still survives",
      (await readEntryText(missingBoth.value.bytes, "word/document.xml")).includes(BODY_TEXT)
    );
  }

  // =========================================================================
  // 6. EMPTY METADATA PARTS
  // =========================================================================

  const emptyParts = await removeSupportedDocxMetadata(
    docxFile(
      await buildDocx({
        core: `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}/>`,
        app: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`,
      })
    )
  );
  check("empty metadata parts succeed", emptyParts.ok);
  if (emptyParts.ok) {
    check("empty parts remove nothing", emptyParts.value.removedProperties.length === 0 && emptyParts.value.emptyProperties.length === 0);
    check("empty parts are not rewritten", emptyParts.value.modifiedParts.length === 0);
    check(
      "empty parts produce no retained-property noise",
      emptyParts.value.retainedProperties.length === 0
    );
    check("empty parts still yield a valid package", (await validateDocxFile(emptyParts.value.bytes, { name: "x.docx" })).ok);
  }

  // =========================================================================
  // 7. ALREADY-EMPTY PROPERTIES
  // =========================================================================

  const alreadyEmpty = await removeSupportedDocxMetadata(
    docxFile(
      await buildDocx({
        core: `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><dc:title/><dc:creator>   </dc:creator><cp:revision>4</cp:revision></cp:coreProperties>`,
        app: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`,
      })
    )
  );
  check("already-empty properties succeed", alreadyEmpty.ok);
  if (alreadyEmpty.ok) {
    check(
      "empty properties are listed separately",
      alreadyEmpty.value.emptyProperties.length === 2 &&
        alreadyEmpty.value.emptyProperties.every((property) => ["title", "creator"].includes(property.field))
    );
    check(
      "empty properties are not counted as removals",
      alreadyEmpty.value.removedProperties.length === 1 && alreadyEmpty.value.removedProperties[0].field === "revision"
    );
    const coreXml = await readEntryText(alreadyEmpty.value.bytes, "docProps/core.xml");
    check("empty elements are dropped from the output", !coreXml.includes("<dc:title") && !coreXml.includes("<dc:creator"));
    check("populated element is dropped too", !coreXml.includes("<cp:revision"));
  }

  // A same-named element in the wrong namespace is a different property, not ours to remove.
  const wrongNamespace = await removeSupportedDocxMetadata(
    docxFile(
      await buildDocx({
        core: `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><cp:creator>Not Dublin Core</cp:creator><dc:title>Real title</dc:title></cp:coreProperties>`,
        app: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`,
      })
    )
  );
  check("wrong-namespace element is not removed", wrongNamespace.ok);
  if (wrongNamespace.ok) {
    check(
      "wrong-namespace element is not reported as removed",
      wrongNamespace.value.removedProperties.length === 1 && wrongNamespace.value.removedProperties[0].field === "title"
    );
    check(
      "wrong-namespace element is reported as retained",
      wrongNamespace.value.retainedProperties.some(
        (property) => property.element === "cp:creator" && property.valuePresent
      )
    );
    check(
      "wrong-namespace element survives in the output",
      (await readEntryText(wrongNamespace.value.bytes, "docProps/core.xml")).includes("cp:creator")
    );
  }

  // =========================================================================
  // 8. UNICODE METADATA
  // =========================================================================

  const unicodeCore = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties ${CORE_NS}>
  <dc:title>Résumé — 世界 🌍</dc:title>
  <dc:creator>مؤلف عربي</dc:creator>
  <dc:description>描述文本</dc:description>
  <cp:keywords>ключевые слова</cp:keywords>
</cp:coreProperties>`;
  const unicodeApp = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Company>株式会社テスト</Company>
  <Manager>Ελένη Παπαδοπούλου</Manager>
</Properties>`;
  const unicode = await removeSupportedDocxMetadata(
    docxFile(await buildDocx({ core: unicodeCore, app: unicodeApp, custom: null }))
  );
  check("unicode metadata cleans successfully", unicode.ok);
  if (unicode.ok) {
    check("unicode core fields are removed", unicode.value.removedProperties.length === 6);
    check("unicode metadata is gone", !JSON.stringify(unicode.value.removedProperties).includes("Résumé"));
    const unicodeAfter = await readDocxMetadata(unicode.value.bytes, { name: "u.docx" });
    check(
      "re-reading unicode output finds nothing supported",
      unicodeAfter.ok && SUPPORTED_METADATA_FIELDS.every((field) => unicodeAfter.value[field] === undefined)
    );
    check("unicode output is a valid package", (await validateDocxFile(unicode.value.bytes, { name: "u.docx" })).ok);
  }

  // =========================================================================
  // 9 / 10. MALFORMED METADATA XML
  // =========================================================================

  const malformedCore = await removeSupportedDocxMetadata(
    docxFile(await buildDocx({ core: `<cp:coreProperties ${CORE_NS}><dc:title>Broken` }))
  );
  check("malformed core.xml fails the operation", !malformedCore.ok);
  check("malformed core.xml is a typed corrupted-package error", resultCode(malformedCore) === "CORRUPTED_PACKAGE");
  check("malformed core.xml returns no output", !("value" in malformedCore));
  check(
    "malformed core.xml is explained",
    !malformedCore.ok &&
      /docProps\/core\.xml/.test(malformedCore.error.message + (malformedCore.error.detail ?? ""))
  );

  const malformedApp = await removeSupportedDocxMetadata(
    docxFile(await buildDocx({ app: `<Properties><Application>Word</Application` }))
  );
  check("malformed app.xml fails the operation", !malformedApp.ok && codeOf(malformedApp.error) === "CORRUPTED_PACKAGE");
  check("malformed app.xml returns no output", !("value" in malformedApp));

  const mismatched = await removeSupportedDocxMetadata(
    docxFile(await buildDocx({ app: `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>1</Properties>` }))
  );
  check("structurally invalid app.xml fails", !mismatched.ok && codeOf(mismatched.error) === "CORRUPTED_PACKAGE");

  const wrongRoot = await removeSupportedDocxMetadata(
    docxFile(await buildDocx({ core: `<?xml version="1.0"?><cp:somethingElse ${CORE_NS}><dc:title>x</dc:title></cp:somethingElse>` }))
  );
  check("unexpected core.xml root is refused", !wrongRoot.ok && codeOf(wrongRoot.error) === "UNSUPPORTED_STRUCTURE");

  // =========================================================================
  // 11. INVALID DOCX INPUT
  // =========================================================================

  const badSignature = await removeSupportedDocxMetadata(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]));
  check("invalid ZIP signature rejected", !badSignature.ok && codeOf(badSignature.error) === "CORRUPTED_PACKAGE");

  const truncated = await removeSupportedDocxMetadata(docxFile(source.slice(0, 48)));
  check("corrupted package rejected", !truncated.ok && codeOf(truncated.error) === "CORRUPTED_PACKAGE");

  const wrongName = await removeSupportedDocxMetadata(docxFile(source, "legacy.doc"));
  check("non-DOCX extension rejected", !wrongName.ok && codeOf(wrongName.error) === "UNSUPPORTED_FORMAT");

  const emptyBytes = await removeSupportedDocxMetadata(new Uint8Array(0));
  check("empty input rejected", !emptyBytes.ok && codeOf(emptyBytes.error) === "EMPTY_DOCUMENT");

  const garbage = await removeSupportedDocxMetadata({} as never);
  check("unsupported input rejected", !garbage.ok && codeOf(garbage.error) === "INVALID_FILE");

  // =========================================================================
  // 12. ENCRYPTED / UNSUPPORTED PACKAGES
  // =========================================================================

  const ole = new Uint8Array(256);
  ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const encrypted = await removeSupportedDocxMetadata(ole);
  check("encrypted container rejected", !encrypted.ok && codeOf(encrypted.error) === "ENCRYPTED_DOCUMENT");
  check("encrypted input returns no output", !("value" in encrypted));

  const macro = await removeSupportedDocxMetadata(source, {
    name: "macro.docx",
    mimeType: "application/vnd.ms-word.document.macroEnabled.12",
  });
  check("macro-enabled container rejected", !macro.ok && codeOf(macro.error) === "UNSUPPORTED_FORMAT");

  // =========================================================================
  // REPORTING EDGE CASES
  // =========================================================================

  const nothingToRemove = await removeSupportedDocxMetadata(
    docxFile(
      await buildDocx({
        core: `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><cp:lastPrinted>2020-01-01T00:00:00Z</cp:lastPrinted></cp:coreProperties>`,
        app: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>Normal.dotm</Template></Properties>`,
        custom: null,
      })
    )
  );
  check("document with no supported metadata succeeds", nothingToRemove.ok);
  if (nothingToRemove.ok) {
    check("nothing is reported as removed", nothingToRemove.value.removedProperties.length === 0);
    check("nothing is rewritten", nothingToRemove.value.modifiedParts.length === 0);
    check("retained properties are still reported", nothingToRemove.value.retainedProperties.length === 2);
    check(
      "retained-only cleanup makes no cleanup warning",
      !nothingToRemove.warnings.some((warning) => warning.code === "METADATA_RETAINED")
    );
  }

  const arrayBufferInput = await removeSupportedDocxMetadata(
    (await buildDocx()).buffer as ArrayBuffer,
    { name: "bytes.docx" }
  );
  check("ArrayBuffer input is accepted", arrayBufferInput.ok && arrayBufferInput.value.outputFileName === "bytes-cleaned.docx");

  // =========================================================================
  // MERGE -> METADATA REMOVAL INTEGRATION (checkpoint A regression)
  // =========================================================================

  const mergeHost = await buildDocx({ bodyText: "Merged alpha paragraph" });
  const mergeSource = await buildDocx({ bodyText: "Merged beta paragraph" });
  const merged = await mergeDocxDocuments([
    { input: docxFile(mergeHost, "merge-host.docx") },
    { input: docxFile(mergeSource, "merge-source.docx") },
  ]);
  check("merged document is produced for cleanup", merged.ok);
  if (merged.ok) {
    const cleanedMerge = await removeSupportedDocxMetadata(merged.value.bytes, {
      name: merged.value.outputFileName,
    });
    check("merged document cleans successfully", cleanedMerge.ok);
    if (cleanedMerge.ok) {
      const cleanedAfterMerge = await readDocxMetadata(cleanedMerge.value.bytes, {
        name: cleanedMerge.value.outputFileName,
      });
      check(
        "cleaned merged document retains no supported metadata",
        cleanedAfterMerge.ok &&
          SUPPORTED_METADATA_FIELDS.every((field) => cleanedAfterMerge.value[field] === undefined)
      );
      const cleanedMergeDocument = await readEntryText(
        cleanedMerge.value.bytes,
        "word/document.xml"
      );
      check(
        "cleaned merged document keeps both source paragraphs",
        cleanedMergeDocument.includes("Merged alpha paragraph") &&
          cleanedMergeDocument.includes("Merged beta paragraph")
      );
      check(
        "cleaned merged document re-validates",
        (await validateDocxFile(cleanedMerge.value.bytes, {
          name: cleanedMerge.value.outputFileName,
        })).ok
      );
    }
  }

  // =========================================================================
  // REAL WORD FILES (local only; skipped when absent)
  // =========================================================================

  const realFiles = [
    "/Users/pranav/Documents/id proof/pranav.docx",
    "/Users/pranav/Downloads/Function Point Calculation.docx",
    "/Users/pranav/Downloads/knowi report.docx",
  ].filter((path) => fs.existsSync(path));

  if (realFiles.length === 0) {
    console.log("SKIP  real Word files not present on this machine");
  }
  for (const path of realFiles) {
    const name = path.split("/").pop() as string;
    const bytes = new Uint8Array(fs.readFileSync(path));
    const result = await removeSupportedDocxMetadata(bytes, { name, mimeType: "" });
    check(`real Word file cleans successfully: ${name}`, result.ok);
    if (!result.ok) continue;

    const realAfter = await readDocxMetadata(result.value.bytes, { name: result.value.outputFileName });
    check(
      `real Word file retains no supported metadata: ${name}`,
      realAfter.ok && SUPPORTED_METADATA_FIELDS.every((field) => realAfter.value[field] === undefined)
    );
    check(
      `real Word file re-validates: ${name}`,
      (await validateDocxFile(result.value.bytes, { name: result.value.outputFileName })).ok
    );
    check(
      `real Word file keeps its document part: ${name}`,
      (await readEntryText(bytes, "word/document.xml")) ===
        (await readEntryText(result.value.bytes, "word/document.xml"))
    );
  }
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
