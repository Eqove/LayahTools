/**
 * DOCX to TXT conversion tests.
 *
 * Covers output naming, MIME type, UTF-8 encoding, empty input, failure propagation and that
 * the conversion delegates to `extractDocxText` rather than re-implementing extraction.
 */

import JSZip from "jszip";
import { DOCX_MIME_TYPE, WORD_NAMESPACE } from "../src/lib/docx/constants";
import {
  DOCX_TO_TXT_FALLBACK_NAME,
  TXT_MIME_TYPE,
  convertDocxToTxt,
  toTxtFileName,
} from "../src/lib/docx/docx-to-txt";
import { extractDocxText } from "../src/lib/docx/extract-text";
import { isDocxError } from "../src/lib/docx/errors";
import type { DocxInput } from "../src/lib/docx/types";

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
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NAMESPACE}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>TXT fixture</dc:title><dc:creator>LayahTools</dc:creator>
</cp:coreProperties>`;

const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Office Word</Application>
</Properties>`;

const wrap = (content: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>${content}<w:sectPr/></w:body></w:document>`;

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function buildDocx(content: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", wrap(content));
  zip.file("word/styles.xml", STYLES);
  zip.file("docProps/core.xml", CORE);
  zip.file("docProps/app.xml", APP);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

const docxFile = (bytes: Uint8Array, name = "example.docx") =>
  new File([bytes as BlobPart], name, { type: DOCX_MIME_TYPE, lastModified: 1 });

async function main() {
  // =========================================================================
  // NORMAL CONVERSION
  // =========================================================================

  const source = await buildDocx(paragraph("Hello TXT"));
  const converted = await convertDocxToTxt(docxFile(source));
  check("normal conversion succeeds", converted.ok);
  if (converted.ok) {
    const value = converted.value;
    check("text is extracted", value.text === "Hello TXT");
    check("character count matches text", value.characterCount === value.text.length);
    check("word count is two", value.wordCount === 2);
    check("original filename kept", value.fileName === "example.docx");
    check("download filename is .txt", value.outputFileName === "example.txt");
    check("MIME type is text/plain with UTF-8", value.mimeType === TXT_MIME_TYPE);
    check("Blob carries the same MIME type", value.blob.type === TXT_MIME_TYPE);
    check("Blob size matches byte length", value.blob.size === value.byteLength);
    check("byte length matches UTF-8 encoding", value.byteLength === new TextEncoder().encode(value.text).length);
    check("bytes decode back to the text", new TextDecoder("utf-8", { fatal: true }).decode(value.bytes) === value.text);
    check("no byte-order mark is written", value.bytes[0] !== 0xef);
    check("Blob text matches", (await value.blob.text()) === value.text);
    check("clean conversion has no warnings", value.warnings.length === 0);
  }

  const multi = await convertDocxToTxt(
    docxFile(await buildDocx(paragraph("First paragraph.") + paragraph("Second paragraph.") + paragraph("Third paragraph.")))
  );
  check(
    "paragraph separation preserved in TXT",
    multi.ok && multi.value.text === "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
  );

  // =========================================================================
  // UNICODE AND MULTILINGUAL TEXT
  // =========================================================================

  const unicodeText = "Héllo — 世界 🌍 مرحبا";
  const unicodeBytes = new TextEncoder().encode(unicodeText);
  const unicode = await convertDocxToTxt(docxFile(await buildDocx(paragraph(unicodeText))));
  check("unicode text converts", unicode.ok && unicode.value.text === unicodeText);
  check(
    "unicode bytes are valid UTF-8 and round-trip",
    unicode.ok &&
      new TextDecoder("utf-8", { fatal: true }).decode(unicode.value.bytes) === unicodeText
  );
  check(
    "multi-byte text has more bytes than characters",
    unicode.ok && unicode.value.byteLength > unicode.value.characterCount
  );
  check(
    "unicode bytes match TextEncoder exactly",
    unicode.ok &&
      unicode.value.bytes.length === unicodeBytes.length &&
      unicode.value.bytes.every((byte, index) => byte === unicodeBytes[index])
  );

  // =========================================================================
  // DELEGATION TO extractDocxText
  // =========================================================================

  const delegationSource = docxFile(await buildDocx(paragraph("Reuse the same engine")));
  const direct = await extractDocxText(delegationSource);
  const viaConversion = await convertDocxToTxt(delegationSource);
  check(
    "conversion returns exactly the extraction text",
    direct.ok && viaConversion.ok && direct.value.text === viaConversion.value.text
  );
  check(
    "conversion returns exactly the extraction counts",
    direct.ok &&
      viaConversion.ok &&
      direct.value.characterCount === viaConversion.value.characterCount &&
      direct.value.wordCount === viaConversion.value.wordCount
  );

  // =========================================================================
  // FILENAMES
  // =========================================================================

  for (const [input, expected] of [
    ["example.docx", "example.txt"],
    ["REPORT.DOCX", "REPORT.txt"],
    ["archive.tar.docx", "archive.tar.txt"],
    ["my notes.docx", "my notes.txt"],
    ["report", "report.txt"],
    ["report.v2", "report.v2.txt"],
    [".docx", DOCX_TO_TXT_FALLBACK_NAME],
    ["   ", DOCX_TO_TXT_FALLBACK_NAME],
  ] as const) {
    check(`filename ${JSON.stringify(input)} -> ${expected}`, toTxtFileName(input) === expected);
  }

  const named = await convertDocxToTxt(await buildDocx(paragraph("Named")), { name: "bytes.docx", mimeType: DOCX_MIME_TYPE });
  check("ArrayBuffer input uses the provided name", named.ok && named.value.outputFileName === "bytes.txt");

  // =========================================================================
  // EMPTY AND INVALID INPUT
  // =========================================================================

  const empty = await convertDocxToTxt(docxFile(await buildDocx("")));
  check("empty document converts", empty.ok);
  if (empty.ok) {
    check("empty document yields empty text and bytes", empty.value.text === "" && empty.value.byteLength === 0);
    check("empty document Blob is empty", empty.value.blob.size === 0);
    check(
      "empty document keeps its EMPTY_TEXT warning",
      empty.value.warnings.some((warning) => warning.code === "EMPTY_TEXT")
    );
  }

  const wrongExtension = await convertDocxToTxt(docxFile(source, "notes.txt"));
  check("invalid extension rejected", !wrongExtension.ok && codeOf(wrongExtension.error) === "UNSUPPORTED_FORMAT");

  const badSignature = await convertDocxToTxt(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  check("invalid ZIP signature rejected", !badSignature.ok && codeOf(badSignature.error) === "CORRUPTED_PACKAGE");

  const corrupted = await convertDocxToTxt(docxFile(source.slice(0, 48)));
  check("corrupted package rejected", !corrupted.ok && codeOf(corrupted.error) === "CORRUPTED_PACKAGE");

  const textBoxOnly = await convertDocxToTxt(
    docxFile(
      await buildDocx(
        `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><w:txbxContent>${paragraph("Only in a text box")}</w:txbxContent></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
      )
    )
  );
  check(
    "extraction failures propagate as processing failures",
    !textBoxOnly.ok && codeOf(textBoxOnly.error) === "PROCESSING_FAILURE"
  );
  check("failed conversions carry no TXT payload", !("value" in textBoxOnly));

  const garbage = await convertDocxToTxt({} as unknown as DocxInput);
  check("unsupported input rejected", !garbage.ok && codeOf(garbage.error) === "INVALID_FILE");

  // =========================================================================
  // WARNING PRESERVATION
  // =========================================================================

  const warningSource = await buildDocx(
    `<w:p><w:pPr><w:pStyle w:val="MissingStyle"/></w:pPr><w:r><w:t>Still readable</w:t></w:r></w:p>`
  );
  const withWarnings = await convertDocxToTxt(docxFile(warningSource));
  check("document with warnings still converts", withWarnings.ok && withWarnings.value.text === "Still readable");
  check(
    "extraction warnings survive conversion",
    withWarnings.ok && withWarnings.value.warnings.some((warning) => warning.code === "EXTRACTION_WARNING")
  );
  const extractedWarningSource = await extractDocxText(docxFile(warningSource));
  check(
    "conversion warnings match extraction warnings",
    extractedWarningSource.ok &&
      withWarnings.ok &&
      JSON.stringify(withWarnings.value.warnings) === JSON.stringify(extractedWarningSource.value.warnings)
  );

  // =========================================================================
  // ORIGINAL FILE SAFETY
  // =========================================================================

  const guardedBytes = new Uint8Array(await buildDocx(paragraph("Untouched original")));
  const snapshot = Array.from(guardedBytes);
  const guardedFile = docxFile(guardedBytes, "guarded.docx");
  const sizeBefore = guardedFile.size;
  const nameBefore = guardedFile.name;
  const result = await convertDocxToTxt(guardedFile);
  check("original bytes unchanged", snapshot.every((byte, index) => guardedBytes[index] === byte));
  check("original File unchanged", guardedFile.size === sizeBefore && guardedFile.name === nameBefore);
  check("output bytes are an independent array", result.ok && result.value.bytes !== guardedBytes);
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
