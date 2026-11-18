/**
 * DOCX text extraction tests.
 *
 * Fixtures are built in memory so the suite is deterministic and works in CI. Real
 * Word-authored files are additionally checked when they exist on the developer machine.
 */

import fs from "node:fs";
import JSZip from "jszip";
import { DOCX_MIME_TYPE, WORD_NAMESPACE } from "../src/lib/docx/constants";
import { extractDocxText, normalizeDocxText } from "../src/lib/docx/extract-text";
import type { DocxInput } from "../src/lib/docx/types";
import { isDocxError } from "../src/lib/docx/errors";

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
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Extraction fixture</dc:title>
  <dc:creator>LayahTools</dc:creator>
</cp:coreProperties>`;

const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Office Word</Application>
</Properties>`;

const body = (content: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>${content}<w:sectPr/></w:body></w:document>`;

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const listItem = (text: string, numId: number) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (rows: string[][]) =>
  `<w:tbl><w:tblPr/>${rows
    .map((cells) => `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`)
    .join("")}</w:tbl>`;

async function buildDocx(documentXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", STYLES);
  zip.file("docProps/core.xml", CORE);
  zip.file("docProps/app.xml", APP);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

const docxFile = (bytes: Uint8Array, name = "fixture.docx") =>
  new File([bytes as BlobPart], name, { type: DOCX_MIME_TYPE, lastModified: 1 });

const extract = (bytes: Uint8Array, name = "fixture.docx") => extractDocxText(docxFile(bytes, name));

// =========================================================================
// TEXT CONTENT
// =========================================================================

async function main() {
  const simple = await extract(await buildDocx(body(paragraph("Hello DOCX"))));
  check("simple document extracts", simple.ok);
  if (simple.ok) {
    check("simple document text", simple.value.text === "Hello DOCX");
    check("character count matches text length", simple.value.characterCount === "Hello DOCX".length);
    check("word count is two", simple.value.wordCount === 2);
    check("original filename preserved", simple.value.fileName === "fixture.docx");
    check("clean document has no warnings", simple.value.warnings.length === 0);
  }

  const multi = await extract(
    await buildDocx(body(paragraph("First paragraph.") + paragraph("Second paragraph.") + paragraph("Third paragraph.")))
  );
  check(
    "paragraphs are separated by a blank line",
    multi.ok && multi.value.text === "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
  );
  check("multiple paragraphs counted as words", multi.ok && multi.value.wordCount === 6);

  const withHeading = await extract(await buildDocx(body(heading("Introduction") + paragraph("Body text follows."))));
  check(
    "heading text is extracted and ordered before the body",
    withHeading.ok && withHeading.value.text === "Introduction\n\nBody text follows."
  );
  check(
    "defined heading style does not produce a warning",
    withHeading.ok && !withHeading.value.warnings.some((warning) => warning.code === "EXTRACTION_WARNING")
  );

  const bullets = await extract(
    await buildDocx(body(listItem("Bullet one", 1) + listItem("Bullet two", 1) + listItem("Bullet three", 1)))
  );
  check("bulleted list items all extracted", bullets.ok && bullets.value.text.split("\n\n").length === 3);
  check(
    "bulleted list order preserved",
    bullets.ok && bullets.value.text === "Bullet one\n\nBullet two\n\nBullet three"
  );

  const numbers = await extract(
    await buildDocx(
      body(listItem("First step", 2) + listItem("Second step", 2) + listItem("Third step", 2) + listItem("Fourth step", 2))
    )
  );
  check("numbered list items all extracted", numbers.ok && numbers.value.text.split("\n\n").length === 4);
  check(
    "numbered list order preserved",
    numbers.ok && numbers.value.text === "First step\n\nSecond step\n\nThird step\n\nFourth step"
  );

  const withTable = await extract(
    await buildDocx(body(table([["Cell A1", "Cell B1"], ["Cell A2", "Cell B2"]])))
  );
  check("table cells all extracted", withTable.ok && withTable.value.text.split("\n\n").length === 4);
  check(
    "table cell content and reading order preserved",
    withTable.ok && withTable.value.text === "Cell A1\n\nCell B1\n\nCell A2\n\nCell B2"
  );

  const mixed = await extract(
    await buildDocx(
      body(
        heading("Report") +
          paragraph("Intro paragraph.") +
          listItem("List entry", 1) +
          table([["Name", "Value"], ["Alpha", "1"]])
      )
    )
  );
  check("mixed content keeps document order", mixed.ok && /Report[\s\S]*Intro paragraph\.[\s\S]*List entry[\s\S]*Name[\s\S]*Alpha/.test(mixed.value.text));

  const undefinedStyle = await extract(
    await buildDocx(body(`<w:p><w:pPr><w:pStyle w:val="MissingStyle"/></w:pPr><w:r><w:t>Still readable</w:t></w:r></w:p>`))
  );
  check("unknown paragraph style still yields its text", undefinedStyle.ok && undefinedStyle.value.text === "Still readable");
  check(
    "Mammoth warnings are surfaced, not swallowed",
    undefinedStyle.ok && undefinedStyle.value.warnings.some((warning) => warning.code === "EXTRACTION_WARNING")
  );

  // =========================================================================
  // EMPTY AND INVALID INPUT
  // =========================================================================

  const emptyBody = await extract(await buildDocx(body("")));
  check("empty body extracts successfully", emptyBody.ok);
  if (emptyBody.ok) {
    check("empty body returns empty text", emptyBody.value.text === "");
    check("empty body counts zero characters and words", emptyBody.value.characterCount === 0 && emptyBody.value.wordCount === 0);
    check("empty body is reported with a warning", emptyBody.value.warnings.some((warning) => warning.code === "EMPTY_TEXT"));
  }

  const imageOnly = await extract(
    await buildDocx(
      body(`<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></w:r></w:p>`)
    )
  );
  check(
    "text-free document warns instead of failing",
    imageOnly.ok && imageOnly.value.text === "" && imageOnly.value.warnings.some((w) => w.code === "EMPTY_TEXT")
  );

  const wrongExtension = await extract(await buildDocx(body(paragraph("Hello"))), "notes.txt");
  check("non-DOCX extension rejected", !wrongExtension.ok && codeOf(wrongExtension.error) === "UNSUPPORTED_FORMAT");

  const badSignature = await extract(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]));
  check("invalid ZIP signature rejected", !badSignature.ok && codeOf(badSignature.error) === "CORRUPTED_PACKAGE");

  const valid = await buildDocx(body(paragraph("Corrupted soon")));
  const corrupted = await extract(valid.slice(0, 48));
  check("corrupted package rejected", !corrupted.ok && codeOf(corrupted.error) === "CORRUPTED_PACKAGE");

  const malformed = await extract(
    await buildDocx(`<w:document xmlns:w="${WORD_NAMESPACE}"><w:body><w:p></w:body></w:document>`)
  );
  check("malformed document XML rejected", !malformed.ok && codeOf(malformed.error) === "CORRUPTED_PACKAGE");

  const textBoxDrawing = (text: string) =>
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><w:txbxContent>${paragraph(text)}</w:txbxContent></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

  // Mammoth does not read text-box content. That must not surface as a clean empty result.
  const textBoxOnly = await extract(await buildDocx(body(textBoxDrawing("Visible only inside a text box"))));
  check(
    "text Mammoth cannot see fails explicitly instead of returning empty",
    !textBoxOnly.ok && codeOf(textBoxOnly.error) === "PROCESSING_FAILURE"
  );

  const partial = await extract(
    await buildDocx(body(paragraph("Body") + textBoxDrawing("Text that mammoth cannot extract at all")))
  );
  check(
    "partially extracted document warns instead of failing",
    partial.ok && partial.value.text === "Body" && partial.value.warnings.some((w) => w.code === "EXTRACTION_INCOMPLETE")
  );

  const oleBytes = new Uint8Array(512);
  oleBytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const encrypted = await extract(oleBytes);
  check("encrypted OLE container rejected", !encrypted.ok && codeOf(encrypted.error) === "ENCRYPTED_DOCUMENT");

  const garbageInput = await extractDocxText({} as unknown as DocxInput);
  check("unsupported input type rejected", !garbageInput.ok && codeOf(garbageInput.error) === "INVALID_FILE");

  check(
    "failures never carry extracted text",
    [wrongExtension, badSignature, corrupted, malformed, encrypted].every((result) => !("value" in result))
  );

  // =========================================================================
  // INPUT SAFETY AND ALTERNATE INPUTS
  // =========================================================================

  const guarded = await buildDocx(body(paragraph("Do not mutate me")));
  const before = Array.from(guarded);
  const guardedFile = docxFile(guarded, "guarded.docx");
  const sizeBefore = guardedFile.size;
  await extractDocxText(guardedFile);
  check("extraction does not mutate input bytes", before.every((byte, index) => guarded[index] === byte));
  check("extraction does not mutate the File", guardedFile.size === sizeBefore && guardedFile.name === "guarded.docx");

  const fromArrayBuffer = await extractDocxText(guarded.slice().buffer as ArrayBuffer, {
    name: "bytes.docx",
    mimeType: DOCX_MIME_TYPE,
  });
  check("ArrayBuffer input extracts with explicit name", fromArrayBuffer.ok && fromArrayBuffer.value.fileName === "bytes.docx");

  check("normalisation collapses excess blank lines", normalizeDocxText("A\r\n\r\n\r\nB   \nC") === "A\n\nB\nC");

  // =========================================================================
  // REAL WORD-GENERATED FILES (local only; skipped when absent)
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
    const bytes = new Uint8Array(fs.readFileSync(path));
    const name = path.split("/").pop() as string;
    const result = await extractDocxText(bytes, { name, mimeType: "" });
    check(`real Word file extracts: ${name}`, result.ok && result.value.text.length > 100);
    if (result.ok) {
      check(`real Word file has no incomplete-extraction warning: ${name}`,
        !result.value.warnings.some((warning) => warning.code === "EXTRACTION_INCOMPLETE"));
      check(`real Word file counts are consistent: ${name}`,
        result.value.characterCount === result.value.text.length && result.value.wordCount > 0);
      check(`real Word file keeps its name: ${name}`, result.value.fileName === name);
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
