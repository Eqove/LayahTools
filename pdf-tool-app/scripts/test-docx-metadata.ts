/**
 * DOCX metadata inspection tests.
 *
 * Fixtures are built in memory; real Word files are additionally checked when present locally.
 */

import fs from "node:fs";
import JSZip from "jszip";
import { DOCX_MIME_TYPE, WORD_NAMESPACE } from "../src/lib/docx/constants";
import { isDocxError } from "../src/lib/docx/errors";
import {
  normalizeMetadataDate,
  readDocxMetadata,
  readMetadataFromPackage,
} from "../src/lib/docx/metadata";
import { inspectDocxFile } from "../src/lib/docx/files";
import { openDocxPackage } from "../src/lib/docx/zip";

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};
const codeOf = (value: unknown) => (isDocxError(value) ? value.code : `not-docx-error:${String(value)}`);

// =========================================================================
// FIXTURES
// =========================================================================

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}"><w:body><w:p><w:r><w:t>Metadata fixture</w:t></w:r></w:p></w:body></w:document>`;

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
</Properties>`;

interface Parts {
  core?: string | null;
  app?: string | null;
  document?: string | null;
}

async function buildDocx(parts: Parts = {}): Promise<Uint8Array> {
  const entries: Record<string, string> = {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": DOCUMENT,
    "docProps/core.xml": FULL_CORE,
    "docProps/app.xml": FULL_APP,
  };
  if (parts.core === null) delete entries["docProps/core.xml"];
  else if (parts.core !== undefined) entries["docProps/core.xml"] = parts.core;
  if (parts.app === null) delete entries["docProps/app.xml"];
  else if (parts.app !== undefined) entries["docProps/app.xml"] = parts.app;
  if (parts.document === null) delete entries["word/document.xml"];
  else if (parts.document !== undefined) entries["word/document.xml"] = parts.document;

  const zip = new JSZip();
  for (const [path, value] of Object.entries(entries)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

const docxFile = (bytes: Uint8Array, name = "metadata.docx") =>
  new File([bytes as BlobPart], name, { type: DOCX_MIME_TYPE, lastModified: 1 });

const read = (bytes: Uint8Array) => readDocxMetadata(docxFile(bytes));

async function main() {
  // =========================================================================
  // COMPLETE METADATA
  // =========================================================================

  const full = await read(await buildDocx());
  check("complete metadata reads successfully", full.ok);
  if (full.ok) {
    const meta = full.value;
    check("title read", meta.title === "Quarterly Report");
    check("subject read", meta.subject === "Finance");
    check("author/creator read", meta.creator === "Ada Lovelace");
    check("description read", meta.description === "Draft for review.");
    check("keywords read", meta.keywords === "finance, draft, q4");
    check("last modified by read", meta.lastModifiedBy === "Grace Hopper");
    check("revision read", meta.revision === "7");
    check("category read", meta.category === "Reports");
    check("created date normalised to ISO", meta.created === "2026-11-15T10:00:00.000Z");
    check("modified date normalised to ISO", meta.modified === "2026-11-16T08:30:00.000Z");
    check("application read", meta.application === "Microsoft Office Word");
    check("application version read", meta.applicationVersion === "16.0000");
    check("company read", meta.company === "LayahTools Ltd");
    check("manager read", meta.manager === "Katherine Johnson");
    check("pages read", meta.pages === 12);
    check("words read", meta.words === 3456);
    check("characters read", meta.characters === 21000);
    check("complete metadata has no warnings", full.warnings.length === 0);
  }

  check(
    "result contains no raw XML",
    full.ok && !JSON.stringify(full.value).includes("<") && !JSON.stringify(full.value).includes("xmlns")
  );

  // =========================================================================
  // MISSING AND EMPTY PROPERTIES
  // =========================================================================

  const sparse = await read(
    await buildDocx({
      core: `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><dc:title>Only a title</dc:title></cp:coreProperties>`,
      app: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Word</Application></Properties>`,
    })
  );
  check("sparsely populated metadata succeeds", sparse.ok);
  if (sparse.ok) {
    check("present property read", sparse.value.title === "Only a title");
    check(
      "absent properties stay undefined",
      sparse.value.subject === undefined &&
        sparse.value.creator === undefined &&
        sparse.value.company === undefined &&
        sparse.value.pages === undefined
    );
    check("absent properties produce no warnings", sparse.warnings.length === 0);
  }

  const empty = await read(
    await buildDocx({
      core: `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}/>`,
      app: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`,
    })
  );
  check("empty metadata files yield an empty object", empty.ok && Object.keys(empty.value).length === 0);
  check("empty metadata files produce no warnings", empty.warnings.length === 0);

  const nonNumeric = await read(
    await buildDocx({
      app: `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>many</Pages><Words></Words><Characters>1,200</Characters></Properties>`,
    })
  );
  check(
    "non-numeric advisory values are dropped instead of guessed",
    nonNumeric.ok &&
      nonNumeric.value.pages === undefined &&
      nonNumeric.value.words === undefined &&
      nonNumeric.value.characters === undefined
  );

  const missingCore = await read(await buildDocx({ core: null }));
  check("missing core.xml still reads app.xml", missingCore.ok && missingCore.value.application === "Microsoft Office Word");
  check(
    "missing core.xml is reported",
    missingCore.ok && missingCore.warnings.some((warning) => warning.code === "MISSING_METADATA" && warning.detail === "docProps/core.xml")
  );

  const missingApp = await read(await buildDocx({ app: null }));
  check("missing app.xml still reads core.xml", missingApp.ok && missingApp.value.title === "Quarterly Report");
  check(
    "missing app.xml is reported",
    missingApp.ok && missingApp.warnings.some((warning) => warning.code === "MISSING_METADATA" && warning.detail === "docProps/app.xml")
  );

  const missingBoth = await read(await buildDocx({ core: null, app: null }));
  check("missing both property parts yields empty metadata", missingBoth.ok && Object.keys(missingBoth.value).length === 0);
  check(
    "missing both parts produces two warnings",
    missingBoth.ok && missingBoth.warnings.filter((warning) => warning.code === "MISSING_METADATA").length === 2
  );

  // =========================================================================
  // MALFORMED METADATA
  // =========================================================================

  const malformedCore = await read(await buildDocx({ core: `<cp:coreProperties ${CORE_NS}><dc:title>Broken` }));
  check("malformed core.xml does not fail the document", malformedCore.ok);
  check(
    "malformed core.xml is reported",
    malformedCore.ok && malformedCore.warnings.some((warning) => warning.code === "MALFORMED_METADATA")
  );
  check(
    "malformed core.xml still allows app.xml",
    malformedCore.ok && malformedCore.value.application === "Microsoft Office Word" && malformedCore.value.title === undefined
  );

  const malformedApp = await read(await buildDocx({ app: `<Properties><Application>Word</Application` }));
  check("malformed app.xml does not fail the document", malformedApp.ok);
  check(
    "malformed app.xml is reported",
    malformedApp.ok && malformedApp.warnings.some((warning) => warning.code === "MALFORMED_METADATA")
  );
  check("malformed app.xml still allows core.xml", malformedApp.ok && malformedApp.value.title === "Quarterly Report");

  // =========================================================================
  // DATES
  // =========================================================================

  check("ISO date with Z normalised", normalizeMetadataDate("2026-11-15T10:00:00Z") === "2026-11-15T10:00:00.000Z");
  check("naive date treated as UTC", normalizeMetadataDate("2026-11-15T10:00:00") === "2026-11-15T10:00:00.000Z");
  check("offset date converted to UTC", normalizeMetadataDate("2026-11-15T12:00:00+02:00") === "2026-11-15T10:00:00.000Z");
  check("date-only value accepted", normalizeMetadataDate("2026-11-15") === "2026-11-15T00:00:00.000Z");
  check("invalid date rejected", normalizeMetadataDate("not-a-date") === undefined);
  check("blank date rejected", normalizeMetadataDate("   ") === undefined);
  check("missing date rejected", normalizeMetadataDate(undefined) === undefined);

  const badDate = await read(
    await buildDocx({
      core: `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><dcterms:created>0000-00-00T00:00:00Z</dcterms:created><dcterms:modified>yesterday</dcterms:modified></cp:coreProperties>`,
    })
  );
  check("invalid stored dates are dropped", badDate.ok && badDate.value.created === undefined && badDate.value.modified === undefined);
  check(
    "invalid stored dates are reported",
    badDate.ok &&
      badDate.warnings.filter((warning) => warning.code === "INVALID_METADATA_VALUE").length === 2
  );

  // =========================================================================
  // UNICODE
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
  const unicode = await read(await buildDocx({ core: unicodeCore, app: unicodeApp }));
  check("unicode metadata read exactly", unicode.ok && unicode.value.title === "Résumé — 世界 🌍");
  check("unicode author read exactly", unicode.ok && unicode.value.creator === "مؤلف عربي");
  check("unicode description read exactly", unicode.ok && unicode.value.description === "描述文本");
  check("unicode keywords read exactly", unicode.ok && unicode.value.keywords === "ключевые слова");
  check("unicode company read exactly", unicode.ok && unicode.value.company === "株式会社テスト");
  check("unicode manager read exactly", unicode.ok && unicode.value.manager === "Ελένη Παπαδοπούλου");

  // =========================================================================
  // INVALID PACKAGES
  // =========================================================================

  const badSignature = await read(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  check("invalid ZIP signature rejected", !badSignature.ok && codeOf(badSignature.error) === "CORRUPTED_PACKAGE");

  const corrupt = await read((await buildDocx()).slice(0, 48));
  check("corrupted package rejected", !corrupt.ok && codeOf(corrupt.error) === "CORRUPTED_PACKAGE");

  const noDocument = await read(await buildDocx({ document: null }));
  check("package without document part rejected", !noDocument.ok && codeOf(noDocument.error) === "UNSUPPORTED_STRUCTURE");

  const wrongName = await readDocxMetadata(docxFile(await buildDocx(), "legacy.doc"));
  check("non-DOCX extension rejected", !wrongName.ok && codeOf(wrongName.error) === "UNSUPPORTED_FORMAT");

  const ole = new Uint8Array(256);
  ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const encrypted = await read(ole);
  check("encrypted container rejected", !encrypted.ok && codeOf(encrypted.error) === "ENCRYPTED_DOCUMENT");

  check("failures carry no metadata payload", !badSignature.ok && !("value" in badSignature));

  // =========================================================================
  // PACKAGE-LEVEL READER AND INSPECTION
  // =========================================================================

  const packageRead = await readMetadataFromPackage(await openDocxPackage(await buildDocx()));
  check("package-level reader matches file-level metadata", packageRead.metadata.title === "Quarterly Report");
  check("package-level reader reports no warnings for clean parts", packageRead.warnings.length === 0);

  const inspected = await inspectDocxFile(docxFile(await buildDocx()));
  check(
    "inspection still exposes metadata after delegation",
    inspected.ok && inspected.value.metadata.applicationVersion === "16.0000" && inspected.value.metadata.manager === "Katherine Johnson"
  );

  // =========================================================================
  // ORIGINAL FILE SAFETY
  // =========================================================================

  const bytes = new Uint8Array(await buildDocx());
  const snapshot = Array.from(bytes);
  const file = docxFile(bytes, "guarded.docx");
  const sizeBefore = file.size;
  await readDocxMetadata(file);
  check("metadata read does not mutate bytes", snapshot.every((byte, index) => bytes[index] === byte));
  check("metadata read does not mutate the File", file.size === sizeBefore && file.name === "guarded.docx");

  // =========================================================================
  // REAL WORD FILES (local only; skipped when absent)
  // =========================================================================

  const realFiles = [
    "/Users/pranav/Documents/id proof/pranav.docx",
    "/Users/pranav/Downloads/Function Point Calculation.docx",
    "/Users/pranav/Downloads/soft ass.docx",
  ].filter((path) => fs.existsSync(path));

  if (realFiles.length === 0) {
    console.log("SKIP  real Word files not present on this machine");
  }
  for (const path of realFiles) {
    const realBytes = new Uint8Array(fs.readFileSync(path));
    const name = path.split("/").pop() as string;
    const result = await readDocxMetadata(realBytes, { name, mimeType: "" });
    check(`real Word file metadata reads: ${name}`, result.ok);
    if (result.ok) {
      check(`real Word file reports an application: ${name}`, Boolean(result.value.application));
      check(
        `real Word file has no malformed-metadata warning: ${name}`,
        !result.warnings.some((warning) => warning.code === "MALFORMED_METADATA")
      );
      check(
        `real Word dates are ISO when present: ${name}`,
        (!result.value.created || /^\d{4}-\d{2}-\d{2}T.*Z$/.test(result.value.created)) &&
          (!result.value.modified || /^\d{4}-\d{2}-\d{2}T.*Z$/.test(result.value.modified))
      );
    }
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
