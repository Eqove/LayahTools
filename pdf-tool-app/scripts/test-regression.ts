import * as fs from "fs";
import * as path from "path";
import { PDFDocument, degrees } from "pdf-lib";
import {
  addPageNumbers,
  createBlankPdf,
  deletePdfPages,
  extractPdfPages,
  mergePdfFiles,
  rearrangePdf,
  redactPdf,
  rotatePdf,
  splitPdfByRanges,
  watermarkPdf,
} from "../src/lib/pdf/operations";
import { rotateSinglePage } from "../src/lib/pdf/page-actions";
import { addsObjects, compareSnapshots, formatReport, rotatedBy, snapshotPdf, writeReports, type FidelityReport, type FidelitySpec } from "./lib/fidelity";

const CORPUS_DIR = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const MANIFEST_PATH = path.join(CORPUS_DIR, "manifest.json");

interface FixtureMetadata {
  id: string;
  name: string;
  category: string;
  sha256: string;
  pageCount: number;
  expected: {
    hasTextLayer: boolean;
    hasImages: boolean;
    hasAnnotations?: boolean;
    hasForms?: boolean;
    formFields?: string[];
    isEncrypted: boolean;
    password?: string;
  };
}

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

function loadFixtureAsFile(fixtureName: string): File {
  const filePath = path.join(CORPUS_DIR, fixtureName);
  const bytes = fs.readFileSync(filePath);
  return new File([bytes as BlobPart], fixtureName, { type: "application/pdf" });
}

async function runRegressionSuite() {
  console.log("=== LAYAHTOOLS REGRESSION RUNNER v1 (Task A-1.7) ===\n");

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Corpus manifest not found at: ${MANIFEST_PATH}`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const fixtures: FixtureMetadata[] = manifest.fixtures;

  check(`Corpus manifest contains fixtures`, fixtures.length >= 10, `${fixtures.length} fixtures`);

  // Verify each fixture loads and baseline characteristics match manifest
  console.log("\n--- 1. Baseline Verification ---");
  for (const f of fixtures) {
    const filePath = path.join(CORPUS_DIR, f.name);
    check(`Fixture exists: ${f.name}`, fs.existsSync(filePath));

    if (f.expected.isEncrypted) {
      // Encrypted PDF check: attempting to load without password throws / indicates encryption
      let threwEncrypted = false;
      try {
        await PDFDocument.load(fs.readFileSync(filePath));
      } catch (err: any) {
        threwEncrypted = true;
      }
      check(`Fixture ${f.id} (${f.name}) correctly identified as encrypted`, threwEncrypted);
    } else {
      const doc = await PDFDocument.load(fs.readFileSync(filePath));
      check(
        `Fixture ${f.id} (${f.name}) opens and pageCount matches baseline`,
        doc.getPageCount() === f.pageCount,
        `Expected ${f.pageCount}, got ${doc.getPageCount()}`
      );
    }
  }

  console.log("\n--- 2. Deterministic Operations & Export-Reopen Cycle ---");

  // Op A: Add Page Numbers to simple-text.pdf
  const simpleFile = loadFixtureAsFile("simple-text.pdf");
  const pagedOut = await addPageNumbers(simpleFile, "DocPage ");
  check("Op: addPageNumbers produced output", pagedOut.length === 1);
  const reloadedPaged = await PDFDocument.load(pagedOut[0].bytes);
  check("Export-reopen: page count preserved after page numbering", reloadedPaged.getPageCount() === 2);

  // Op B: Rotate PDF (multi-column.pdf, rotate 90 degrees)
  const multiColFile = loadFixtureAsFile("multi-column.pdf");
  const rotatedOut = await rotatePdf(multiColFile, 90);
  check("Op: rotatePdf produced output", rotatedOut.length === 1);
  const reloadedRotated = await PDFDocument.load(rotatedOut[0].bytes);
  const p0Rotation = reloadedRotated.getPage(0).getRotation().angle;
  check("Export-reopen: page rotation angle updated", p0Rotation === 90, `got ${p0Rotation} deg`);

  // Op C: Watermark PDF (table-heavy.pdf)
  const tableFile = loadFixtureAsFile("table-heavy.pdf");
  const watermarkedOut = await watermarkPdf(tableFile, "CONFIDENTIAL");
  check("Op: watermarkPdf produced output", watermarkedOut.length === 1);
  const reloadedWatermarked = await PDFDocument.load(watermarkedOut[0].bytes);
  check("Export-reopen: watermark PDF valid and intact", reloadedWatermarked.getPageCount() === 1);

  // Op D: Delete Pages (from 3-page multi-column.pdf, delete page 2)
  const deletedOut = await deletePdfPages(multiColFile, "2");
  check("Op: deletePdfPages produced output", deletedOut.length === 1);
  const reloadedDeleted = await PDFDocument.load(deletedOut[0].bytes);
  check("Export-reopen: delete page reduced count from 3 to 2", reloadedDeleted.getPageCount() === 2);

  // Op E: Extract Pages (extract page 1-2 from 25-page long-document.pdf)
  const longFile = loadFixtureAsFile("long-document.pdf");
  const extractedOut = await extractPdfPages(longFile, "1-2");
  check("Op: extractPdfPages produced output", extractedOut.length === 1);
  const reloadedExtracted = await PDFDocument.load(extractedOut[0].bytes);
  check("Export-reopen: extracted subset has exactly 2 pages", reloadedExtracted.getPageCount() === 2);

  // Op F: Split PDF (split simple 2-page document into single pages "1, 2")
  const splitOut = await splitPdfByRanges(simpleFile, "1, 2");
  check("Op: splitPdfByRanges produced 2 parts", splitOut.length === 2);
  const reloadedPart1 = await PDFDocument.load(splitOut[0].bytes);
  const reloadedPart2 = await PDFDocument.load(splitOut[1].bytes);
  check("Export-reopen: part 1 has 1 page", reloadedPart1.getPageCount() === 1);
  check("Export-reopen: part 2 has 1 page", reloadedPart2.getPageCount() === 1);

  // Op G: Create Blank PDF (3 pages)
  const blankOut = await createBlankPdf({
    pageCount: 3,
    width: 595,
    height: 842,
    title: "Project Scope",
    body: "1. Baseline\n2. Validation\n3. Gate A",
  });
  check("Op: createBlankPdf produced output", blankOut.length === 1);
  const reloadedBlank = await PDFDocument.load(blankOut[0].bytes);
  check("Export-reopen: created blank PDF has 3 pages", reloadedBlank.getPageCount() === 3);

  // Op H: AcroForm structure verification
  const formBytes = fs.readFileSync(path.join(CORPUS_DIR, "form-acroform.pdf"));
  const formDoc = await PDFDocument.load(formBytes);
  const form = formDoc.getForm();
  const fields = form.getFields().map((f) => f.getName());
  check(
    "AcroForm fixture contains expected form fields",
    fields.includes("applicant.name") && fields.includes("applicant.email"),
    fields.join(", ")
  );

  // -------------------------------------------------------------
  // 3. Fidelity: affected vs unaffected pages (A-4.1, on top of A-1.7 / A-1.8)
  // -------------------------------------------------------------
  console.log("\n--- 3. Fidelity: affected vs unaffected pages ---");
  const reports: FidelityReport[] = [];
  const fidelity = async (fixture: string, operation: string, out: Uint8Array, spec: Omit<FidelitySpec, "fixture" | "operation">) => {
    const b = await snapshotPdf(new Uint8Array(fs.readFileSync(path.join(CORPUS_DIR, fixture))));
    const report = compareSnapshots(b, await snapshotPdf(out), { fixture, operation, ...spec });
    reports.push(report);
    const group = (g: FidelityReport["affected"]) => (g.results.length ? `${g.pages.map((p) => p + 1).join(",")} ${g.pass ? "PASS" : "FAIL"}` : "none");
    check(`Fidelity ${fixture}: ${operation}`, report.pass, `affected: ${group(report.affected)}; unaffected: ${group(report.unaffected)}`);
    if (!report.pass) console.log(formatReport(report));
  };
  const asBytes = async (f: File) => new Uint8Array(await f.arrayBuffer());

  await fidelity("multi-column.pdf", "rotate page 2 by 90", await asBytes(await rotateSinglePage(multiColFile, 1, 90)), { affectedPages: [1], expectAffected: rotatedBy(90) });
  await fidelity("multi-column.pdf", "rotate all pages by 90", rotatedOut[0].bytes, { affectedPages: [0, 1, 2], expectAffected: rotatedBy(90) });
  await fidelity("multi-column.pdf", "delete page 2", deletedOut[0].bytes, { affectedPages: [], pageMap: [0, null, 1] });
  await fidelity("multi-column.pdf", "rearrange to 3,1,2", (await rearrangePdf(multiColFile, [2, 0, 1]))[0].bytes, { affectedPages: [], pageMap: [1, 2, 0] });
  await fidelity(
    "multi-column.pdf",
    "draw a rectangle on page 1 (redact)",
    (await redactPdf(multiColFile, [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }]))[0].bytes,
    { affectedPages: [0], expectAffected: addsObjects({ path: 1 }) },
  );
  await fidelity("table-heavy.pdf", "watermark", watermarkedOut[0].bytes, { affectedPages: [0], expectAffected: addsObjects({ text: 1 }) });
  await fidelity("simple-text.pdf", "add page numbers", pagedOut[0].bytes, { affectedPages: [0, 1], expectAffected: addsObjects({ text: 1 }) });
  await fidelity("long-document.pdf", "extract pages 1-2", extractedOut[0].bytes, { affectedPages: [], pageMap: Array.from({ length: 25 }, (_, i) => (i < 2 ? i : null)) });
  await fidelity("simple-text.pdf", "merge with table-heavy.pdf", (await mergePdfFiles([simpleFile, tableFile]))[0].bytes, { affectedPages: [], pageMap: [0, 1], addedPages: [2] });
  const reportPath = writeReports(reports);
  check("Fidelity report written", fs.existsSync(reportPath), reportPath);

  console.log(`\n=================================================`);
  console.log(failed ? `${failed} TESTS FAILED` : "ALL REGRESSION SUITE TESTS PASSED");
  console.log(`=================================================\n`);

  process.exit(failed ? 1 : 0);
}

runRegressionSuite().catch((err) => {
  console.error("Regression suite encountered unhandled error:", err);
  process.exit(1);
});
