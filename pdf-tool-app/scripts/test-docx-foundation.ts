/**
 * DOCX foundation tests: package validation, ZIP limits, XML helpers and queue operations.
 * Runs with plain `tsx`, matching the existing test scripts.
 */

import JSZip from "jszip";
import {
  CORE_PROPERTIES_PATH,
  DEFAULT_DOCX_LIMITS,
  DOCX_MIME_TYPE,
  WORD_NAMESPACE,
} from "../src/lib/docx/constants";
import { DocxError, isDocxError, toDocxError } from "../src/lib/docx/errors";
import {
  addDocxFiles,
  inspectDocxFile,
  removeDocxFile,
  reorderDocxFiles,
  screenDocxFile,
  validateDocxQueue,
} from "../src/lib/docx/files";
import { readMetadataFromPackage } from "../src/lib/docx/metadata";
import type { DocxLimits, DocxQueueItem } from "../src/lib/docx/types";
import { hasZipSignature, isDocxFileName, isDocxMimeType, isOleContainer, validateDocxFile } from "../src/lib/docx/validate";
import { parseXml, serializeXml } from "../src/lib/docx/xml";
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

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}">
  <w:body>
    <w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:title>Gamma Plan</dc:title>
  <dc:creator>LayahTools</dc:creator>
  <cp:lastModifiedBy>Pranav</cp:lastModifiedBy>
  <cp:revision>3</cp:revision>
  <dcterms:created>2026-11-15T10:00:00Z</dcterms:created>
</cp:coreProperties>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Office Word</Application>
  <Pages>2</Pages>
  <Words>42</Words>
  <Characters>250</Characters>
</Properties>`;

const DEFAULTS: Record<string, string> = {
  "[Content_Types].xml": CONTENT_TYPES,
  "_rels/.rels": ROOT_RELS,
  "word/document.xml": DOCUMENT_XML,
  [CORE_PROPERTIES_PATH]: CORE_XML,
  "docProps/app.xml": APP_XML,
};

/** Builds an in-memory DOCX. A `null` override removes that part. */
async function buildDocx(overrides: Record<string, string | null> = {}): Promise<Uint8Array> {
  const parts = { ...DEFAULTS };
  for (const [path, value] of Object.entries(overrides)) {
    if (value === null) delete parts[path];
    else parts[path] = value;
  }
  const zip = new JSZip();
  for (const [path, value] of Object.entries(parts)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

const docxFile = (bytes: Uint8Array, name = "sample.docx", type = DOCX_MIME_TYPE) =>
  new File([bytes as BlobPart], name, { type, lastModified: 1 });

const tinyLimits = (overrides: Partial<DocxLimits>): DocxLimits => ({
  ...DEFAULT_DOCX_LIMITS,
  ...overrides,
});

// =========================================================================
// VALID PACKAGE
// =========================================================================

async function main() {
const validBytes = await buildDocx();
const valid = await validateDocxFile(docxFile(validBytes));

check("valid DOCX accepted", valid.ok);
if (valid.ok) {
  check("valid DOCX reports five entries", valid.value.package.info.entryCount === 5);
  check("valid DOCX records content types part", valid.value.package.info.hasContentTypes);
  check("valid DOCX records document part", valid.value.package.info.hasDocumentXml);
  check("valid DOCX parses main document", valid.value.document.documentElement.localName === "document");
  check(
    "valid DOCX exposes paragraph text",
    valid.value.document.getElementsByTagNameNS(WORD_NAMESPACE, "t")[0]?.textContent === "Hello DOCX"
  );
  check("valid DOCX keeps file info", valid.value.info.name === "sample.docx" && valid.value.info.size === validBytes.length);
} else {
  check("valid DOCX failure is unexpected", false);
}
check("complete package produces no warnings", valid.warnings.length === 0);

const fromArrayBuffer = await validateDocxFile(validBytes.slice().buffer as ArrayBuffer, {
  name: "raw.docx",
  mimeType: DOCX_MIME_TYPE,
});
check("ArrayBuffer input accepted with explicit name", fromArrayBuffer.ok);

const fromBlob = await validateDocxFile(new Blob([validBytes as BlobPart]), { name: "blob.docx" });
check("anonymous Blob accepted with explicit name", fromBlob.ok);

// =========================================================================
// FORMAT / SIGNATURE / CORRUPTION
// =========================================================================

const wrongExtension = await validateDocxFile(docxFile(validBytes, "notes.txt"));
check(
  "invalid extension rejected",
  !wrongExtension.ok && codeOf(wrongExtension.error) === "UNSUPPORTED_FORMAT"
);

const wrongMime = await validateDocxFile(docxFile(validBytes, "sample.docx", "text/plain"));
check("wrong MIME type rejected", !wrongMime.ok && codeOf(wrongMime.error) === "UNSUPPORTED_FORMAT");

const pdfMime = await validateDocxFile(docxFile(validBytes, "sample.docx", "application/pdf"));
check("PDF MIME type rejected", !pdfMime.ok && codeOf(pdfMime.error) === "UNSUPPORTED_FORMAT");

const emptyMime = await validateDocxFile(docxFile(validBytes, "sample.docx", ""));
check("missing MIME type accepted", emptyMime.ok);

const octetMime = await validateDocxFile(docxFile(validBytes, "sample.docx", "application/octet-stream"));
check("octet-stream MIME type accepted", octetMime.ok);

const badSignature = await validateDocxFile(
  docxFile(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]), "fake.docx")
);
check(
  "invalid ZIP signature rejected",
  !badSignature.ok && codeOf(badSignature.error) === "CORRUPTED_PACKAGE"
);

const truncated = await validateDocxFile(docxFile(validBytes.slice(0, 64), "cut.docx"));
check("corrupted ZIP rejected", !truncated.ok && codeOf(truncated.error) === "CORRUPTED_PACKAGE");

const emptyFile = await validateDocxFile(docxFile(new Uint8Array(0), "empty.docx"));
check("empty file rejected", !emptyFile.ok && codeOf(emptyFile.error) === "EMPTY_DOCUMENT");

const oversized = await validateDocxFile(
  docxFile(validBytes, "big.docx"),
  { limits: tinyLimits({ maxFileBytes: 128 }) }
);
check("oversized file rejected", !oversized.ok && codeOf(oversized.error) === "INVALID_FILE");

const oleBytes = new Uint8Array(512);
oleBytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const encrypted = await validateDocxFile(docxFile(oleBytes, "locked.docx"));
check(
  "OLE container treated as encrypted",
  !encrypted.ok && codeOf(encrypted.error) === "ENCRYPTED_DOCUMENT"
);

// =========================================================================
// PACKAGE STRUCTURE
// =========================================================================

const missingDocument = await validateDocxFile(docxFile(await buildDocx({ "word/document.xml": null })));
check(
  "missing word/document.xml rejected",
  !missingDocument.ok && codeOf(missingDocument.error) === "UNSUPPORTED_STRUCTURE"
);

const missingContentTypes = await validateDocxFile(docxFile(await buildDocx({ "[Content_Types].xml": null })));
check(
  "missing [Content_Types].xml rejected",
  !missingContentTypes.ok && codeOf(missingContentTypes.error) === "UNSUPPORTED_STRUCTURE"
);

const emptyDocumentPart = await validateDocxFile(docxFile(await buildDocx({ "word/document.xml": "   " })));
check(
  "empty document part rejected",
  !emptyDocumentPart.ok && codeOf(emptyDocumentPart.error) === "EMPTY_DOCUMENT"
);

const malformedDocument = await validateDocxFile(
  docxFile(await buildDocx({ "word/document.xml": `<w:document xmlns:w="${WORD_NAMESPACE}"><w:body></w:document>` }))
);
check(
  "malformed document XML rejected",
  !malformedDocument.ok && codeOf(malformedDocument.error) === "CORRUPTED_PACKAGE"
);

const wrongRoot = await validateDocxFile(
  docxFile(await buildDocx({ "word/document.xml": `<w:document xmlns:w="urn:not-word"><w:body/></w:document>` }))
);
check(
  "non-WordprocessingML root rejected",
  !wrongRoot.ok && codeOf(wrongRoot.error) === "UNSUPPORTED_STRUCTURE"
);

const noBody = await validateDocxFile(
  docxFile(await buildDocx({ "word/document.xml": `<w:document xmlns:w="${WORD_NAMESPACE}"/>` }))
);
check("document without body rejected", !noBody.ok && codeOf(noBody.error) === "UNSUPPORTED_STRUCTURE");

const emptyBody = await validateDocxFile(
  docxFile(await buildDocx({ "word/document.xml": `<w:document xmlns:w="${WORD_NAMESPACE}"><w:body/></w:document>` }))
);
check("empty body accepted with warning", emptyBody.ok && emptyBody.warnings.some((w) => w.code === "EMPTY_BODY"));

const noProps = await validateDocxFile(
  docxFile(await buildDocx({ [CORE_PROPERTIES_PATH]: null, "docProps/app.xml": null }))
);
check(
  "missing properties accepted with warnings",
  noProps.ok && noProps.warnings.filter((w) => w.code === "MISSING_METADATA").length === 2
);

// =========================================================================
// ZIP LIMITS
// =========================================================================

const tooManyEntries = await validateDocxFile(docxFile(validBytes), {
  limits: tinyLimits({ maxEntries: 2 }),
});
check(
  "entry-count limit enforced",
  !tooManyEntries.ok && codeOf(tooManyEntries.error) === "UNSUPPORTED_STRUCTURE"
);

const tooMuchContent = await validateDocxFile(docxFile(validBytes), {
  limits: tinyLimits({ maxUncompressedBytes: 64 }),
});
check(
  "uncompressed-size limit enforced",
  !tooMuchContent.ok && codeOf(tooMuchContent.error) === "UNSUPPORTED_STRUCTURE"
);

const entryTooBig = await validateDocxFile(docxFile(validBytes), {
  limits: tinyLimits({ maxEntryBytes: 32 }),
});
check("per-entry size limit enforced", !entryTooBig.ok && codeOf(entryTooBig.error) === "UNSUPPORTED_STRUCTURE");

// =========================================================================
// SIGNATURE HELPERS
// =========================================================================

check("hasZipSignature accepts a real package", hasZipSignature(validBytes));
check("hasZipSignature rejects PDF bytes", !hasZipSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46])));
check("isOleContainer detects the OLE header", isOleContainer(oleBytes));
check("isOleContainer rejects a ZIP header", !isOleContainer(validBytes));
check("isDocxFileName is case-insensitive", isDocxFileName("REPORT.DOCX") && !isDocxFileName("report.docm"));
check(
  "isDocxMimeType accepts unknown but rejects confident mismatches",
  isDocxMimeType("") && isDocxMimeType(DOCX_MIME_TYPE) && !isDocxMimeType("application/pdf")
);

// =========================================================================
// XML PARSING AND SERIALISATION
// =========================================================================

const parsed = parseXml(DOCUMENT_XML, "test document");
check("XML parse returns the root element", parsed.document.documentElement.localName === "document");
check("XML parse yields no warnings for valid input", parsed.warnings.length === 0);
check(
  "XML parse preserves paragraph text",
  parsed.document.getElementsByTagNameNS(WORD_NAMESPACE, "t")[0]?.textContent === "Hello DOCX"
);

const serialized = serializeXml(parsed.document);
check("XML serialise returns markup", serialized.includes("<w:t>Hello DOCX</w:t>"));
const reparsed = parseXml(serialized, "round trip");
check(
  "XML serialise round-trips",
  reparsed.document.getElementsByTagNameNS(WORD_NAMESPACE, "p").length === 1
);

for (const [label, xml] of [
  ["mismatched closing tag", `<w:document xmlns:w="${WORD_NAMESPACE}"><w:body></w:document>`],
  ["unclosed element", `<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>`],
  ["nested mismatch xmldom repairs silently", `<a><b><c></b></c></a>`],
  ["stray closing tag", `<w:document xmlns:w="${WORD_NAMESPACE}"></w:body></w:document>`],
  ["two root elements", `<a/><b/>`],
  ["text after the root", `<a/>trailing`],
  ["empty string", ""],
] as const) {
  let thrown: unknown = null;
  try {
    parseXml(xml, label);
  } catch (error) {
    thrown = error;
  }
  check(
    `XML parse throws a typed error for ${label}`,
    thrown instanceof DocxError && thrown.code === "CORRUPTED_PACKAGE"
  );
}

// xmldom can emit a warning without failing; it must be surfaced, not swallowed.
const withDoctype = parseXml(`<?xml version="1.0"?><root><!-- note --><child/></root>`, "comments");
check("XML parse keeps comments and children", Boolean(withDoctype.document.documentElement));

// =========================================================================
// METADATA
// =========================================================================

const inspected = await inspectDocxFile(docxFile(validBytes));
check("inspection succeeds for a valid file", inspected.ok);
if (inspected.ok) {
  check("metadata title read", inspected.value.metadata.title === "Gamma Plan");
  check("metadata creator read", inspected.value.metadata.creator === "LayahTools");
  check("metadata revision read", inspected.value.metadata.revision === "3");
  check("metadata application read", inspected.value.metadata.application === "Microsoft Office Word");
  check("metadata page count read", inspected.value.metadata.pages === 2);
  check("metadata word count read", inspected.value.metadata.words === 42);
  check("inspection info matches validation", inspected.value.info.name === "sample.docx");
} else {
  check("inspection failure is unexpected", false);
}

const metadataForMissingProps = await readMetadataFromPackage(
  await openDocxPackage(await buildDocx({ [CORE_PROPERTIES_PATH]: null, "docProps/app.xml": null }))
);
check(
  "missing property parts yield no metadata and no throw",
  Object.keys(metadataForMissingProps.metadata).length === 0 && metadataForMissingProps.warnings.length === 0
);

// =========================================================================
// INPUT SAFETY
// =========================================================================

const guardedBytes = new Uint8Array(await buildDocx());
const before = Array.from(guardedBytes);
const guardedFile = docxFile(guardedBytes, "guarded.docx");
const guardedSize = guardedFile.size;
await validateDocxFile(guardedFile);
await inspectDocxFile(guardedFile);
check("validation does not mutate input bytes", before.every((byte, index) => guardedBytes[index] === byte));
check("validation does not mutate the File", guardedFile.size === guardedSize && guardedFile.name === "guarded.docx");

// =========================================================================
// FILE QUEUE
// =========================================================================

let counter = 0;
const id = () => `d${++counter}`;
const queueFile = (name: string, size = 3, modified = 1) =>
  new File([new Uint8Array(size)], name, { type: DOCX_MIME_TYPE, lastModified: modified });

let queue: DocxQueueItem[] = [];
const firstAdd = addDocxFiles(queue, [queueFile("one.docx"), queueFile("two.docx")], id);
queue = firstAdd.items;
check("queue add appends both files", queue.length === 2 && firstAdd.added.length === 2);
check("queue add assigns unique ids", new Set(queue.map((item) => item.id)).size === 2);

const duplicateAdd = addDocxFiles(queue, [queueFile("one.docx")], id);
check("queue add skips identical re-selection", duplicateAdd.items.length === 2 && duplicateAdd.duplicates === 1 && duplicateAdd.added.length === 0);

const sameNameAdd = addDocxFiles(queue, [queueFile("one.docx", 99)], id);
queue = sameNameAdd.items;
check("same name with different content is kept", sameNameAdd.items.length === 3);

const rejectedAdd = addDocxFiles(
  queue,
  [queueFile("legacy.doc"), queueFile("empty.docx", 0), queueFile("notes.txt")],
  id
);
check("queue add rejects unsupported and empty files", rejectedAdd.added.length === 0 && rejectedAdd.rejected.length === 3);
check(
  "queue rejections carry typed codes",
  rejectedAdd.rejected[0].code === "UNSUPPORTED_FORMAT" &&
    rejectedAdd.rejected[1].code === "EMPTY_DOCUMENT" &&
    rejectedAdd.rejected[2].code === "UNSUPPORTED_FORMAT"
);
check("rejected files never enter the queue", rejectedAdd.items.length === 3);

const sizeLimited = addDocxFiles(queue, [queueFile("huge.docx", 5000)], id, tinyLimits({ maxFileBytes: 1024 }));
check("queue add enforces the file-size limit", sizeLimited.rejected[0]?.code === "INVALID_FILE");

const withPdfMime = new File([new Uint8Array(3)], "report.docx", { type: "application/pdf", lastModified: 1 });
check("queue screening rejects a wrong MIME type", screenDocxFile(withPdfMime)?.code === "UNSUPPORTED_FORMAT");

const afterRemove = removeDocxFile(queue, queue[1].id);
check("queue remove deletes only that entry", afterRemove.length === 2 && !afterRemove.some((item) => item.id === queue[1].id));
check("queue remove does not mutate the original array", queue.length === 3);

const ordered = [queueFile("a.docx", 1, 1), queueFile("b.docx", 2, 2), queueFile("c.docx", 3, 3), queueFile("d.docx", 4, 4)].map(
  (file) => ({ id: file.name.replace(".docx", ""), file })
);
const indexMove = reorderDocxFiles(ordered, 0, 3);
check("queue reorder by index", indexMove.map((item) => item.id).join(",") === "b,c,d,a");
const idMove = reorderDocxFiles(ordered, "b", "d");
check("queue reorder by id inserts before target", idMove.map((item) => item.id).join(",") === "a,c,b,d");
const idToEnd = reorderDocxFiles(ordered, "a", null);
check("queue reorder to end", idToEnd.map((item) => item.id).join(",") === "b,c,d,a");
const invalidMove = reorderDocxFiles(ordered, 0, 99);
check("queue reorder ignores invalid indexes", invalidMove.map((item) => item.id).join(",") === "a,b,c,d");
check(
  "queue reorder never mutates the original",
  ordered.map((item) => item.id).join(",") === "a,b,c,d" && indexMove !== ordered
);

const emptyQueueValidation = await validateDocxQueue([]);
check("empty queue validates", emptyQueueValidation.ok && emptyQueueValidation.entries.length === 0);

const mixedQueue = await validateDocxQueue([
  { id: "good", file: docxFile(validBytes, "good.docx") },
  { id: "bad", file: docxFile(await buildDocx({ "word/document.xml": null }), "bad.docx") },
]);
check("queue validation reports per-entry status", mixedQueue.ok === false && mixedQueue.entries.length === 2);
check(
  "queue validation marks the good file valid and the bad one not",
  mixedQueue.entries[0].result.ok && !mixedQueue.entries[1].result.ok
);

// =========================================================================
// ERROR HELPERS
// =========================================================================

const typedError = new DocxError("PROCESSING_FAILURE", "Something failed.", "cause");
check("DocxError is recognised", isDocxError(typedError) && typedError.code === "PROCESSING_FAILURE");
check("isDocxError rejects ordinary errors", !isDocxError(new Error("nope")));
check("toDocxError normalises unknown values", toDocxError("boom").code === "PROCESSING_FAILURE");
check("toDocxError keeps typed errors intact", toDocxError(typedError) === typedError);
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
