import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { readPdfMetadata } from "../src/lib/pdf/metadata";
import { isEncryptedPdf, unlockEncryptedPdf } from "../src/lib/pdf/password";
import { cropPdf } from "../src/lib/pdf/operations";
import {
  rotateSinglePage,
  deleteSinglePage,
  extractSinglePage,
} from "../src/lib/pdf/page-actions";

const CORPUS_DIR = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");

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

async function runPhase2Tests() {
  console.log("=== LAYAHTOOLS PHASE 2 CAPABILITY TEST SUITE ===\n");

  // -------------------------------------------------------------
  // 1. Document Metadata Extraction Tests
  // -------------------------------------------------------------
  console.log("--- 1. Document Metadata Extraction ---");
  const simpleFile = loadFixtureAsFile("simple-text.pdf");
  const simpleMeta = await readPdfMetadata(simpleFile);

  check("Metadata: pageCount matches baseline", simpleMeta.pageCount === 2, `got ${simpleMeta.pageCount}`);
  check("Metadata: fileSizeBytes extracted", simpleMeta.fileSizeBytes === simpleFile.size);
  check("Metadata: fileName preserved", simpleMeta.fileName === "simple-text.pdf");

  const annotatedFile = loadFixtureAsFile("annotated.pdf");
  const annotatedMeta = await readPdfMetadata(annotatedFile);
  check("Metadata: annotated PDF loaded and has valid pageCount", annotatedMeta.pageCount === 1);

  // -------------------------------------------------------------
  // 2. Encryption Detection & Password Decryption Tests
  // -------------------------------------------------------------
  console.log("\n--- 2. Password & Encryption Handling ---");
  const encryptedFile = loadFixtureAsFile("password-protected.pdf");

  const isEnc = await isEncryptedPdf(encryptedFile);
  check("Encryption detection: password-protected.pdf identified as encrypted", isEnc === true);

  const isNotEnc = await isEncryptedPdf(simpleFile);
  check("Encryption detection: simple-text.pdf identified as unencrypted", isNotEnc === false);

  // Incorrect password rejection
  let failedAsExpected = false;
  try {
    await unlockEncryptedPdf(encryptedFile, "wrongpassword999");
  } catch (err: any) {
    failedAsExpected = true;
    check("Password unlock: invalid password rejected with clear message", err.message.includes("Incorrect password"));
  }
  if (!failedAsExpected) {
    check("Password unlock: invalid password rejected", false, "did not throw error");
  }

  // Correct password decryption
  const unlockedFile = await unlockEncryptedPdf(encryptedFile, "testpassword123");
  check("Password unlock: correct password successfully unlocks document", unlockedFile instanceof File);
  check("Password unlock: unlocked file maintains PDF mime type", unlockedFile.type === "application/pdf");

  // Re-open validation: Unlocked PDF must open cleanly WITHOUT any password
  const unlockedBytes = await unlockedFile.arrayBuffer();
  const openedDoc = await PDFDocument.load(unlockedBytes);
  check(
    "Export-reopen: unlocked PDF opens natively without encryption parameters",
    openedDoc.getPageCount() === 1
  );

  // -------------------------------------------------------------
  // 3. Deterministic PDF Cropping Tests
  // -------------------------------------------------------------
  console.log("\n--- 3. Deterministic PDF Cropping ---");
  const cropMargins = { top: 36, right: 36, bottom: 36, left: 36 }; // 0.5 inch margins
  const cropResults = await cropPdf(simpleFile, cropMargins);

  check("Crop: produces output file", cropResults.length === 1);
  check("Crop: filename contains 'cropped'", cropResults[0].filename.includes("cropped"));

  // Reopen and verify dimensions
  const croppedDoc = await PDFDocument.load(cropResults[0].bytes);
  check("Export-reopen: cropped PDF reopens cleanly", croppedDoc.getPageCount() === 2);

  const croppedPage0 = croppedDoc.getPage(0);
  const cropBox = croppedPage0.getCropBox();
  check(
    "Crop coordinate geometry: cropBox origin matches left/bottom margins",
    cropBox.x === cropMargins.left && cropBox.y === cropMargins.bottom,
    `x=${cropBox.x}, y=${cropBox.y}`
  );

  // Overly large crop margins rejection
  let cropErrorCaught = false;
  try {
    await cropPdf(simpleFile, { top: 1000, right: 1000, bottom: 1000, left: 1000 });
  } catch (err: any) {
    cropErrorCaught = true;
    check("Crop validation: excessive margins rejected safely", err.message.includes("Crop margins too large"));
  }
  if (!cropErrorCaught) {
    check("Crop validation: excessive margins rejected safely", false);
  }

  // -------------------------------------------------------------
  // 4. Single-Page Quick Actions Tests
  // -------------------------------------------------------------
  console.log("\n--- 4. Single-Page Quick Actions ---");
  const multiColFile = loadFixtureAsFile("multi-column.pdf"); // 3 pages

  // Rotate single page
  const rotatedSingle = await rotateSinglePage(multiColFile, 0, 90);
  const rotatedDoc = await PDFDocument.load(await rotatedSingle.arrayBuffer());
  check("Quick action: rotateSinglePage rotates target page 90 deg", rotatedDoc.getPage(0).getRotation().angle === 90);
  check("Quick action: rotateSinglePage leaves subsequent pages unrotated", rotatedDoc.getPage(1).getRotation().angle === 0);

  // Delete single page
  const deletedSingle = await deleteSinglePage(multiColFile, 1);
  const deletedDoc = await PDFDocument.load(await deletedSingle.arrayBuffer());
  check("Quick action: deleteSinglePage reduces page count from 3 to 2", deletedDoc.getPageCount() === 2);

  // Delete guard on single page document
  let deleteGuardCaught = false;
  try {
    await deleteSinglePage(simpleFile, 0); // 2 pages -> ok
    const onePageDoc = await deleteSinglePage(simpleFile, 1);
    await deleteSinglePage(onePageDoc, 0); // 1 page -> should throw
  } catch (err: any) {
    deleteGuardCaught = true;
    check("Quick action: deleteSinglePage guard prevents deleting only page", err.message.includes("Cannot delete the only page"));
  }
  if (!deleteGuardCaught) {
    check("Quick action: deleteSinglePage guard prevents deleting only page", false);
  }

  // Extract single page
  const extractedSingle = await extractSinglePage(multiColFile, 2);
  const extractedDoc = await PDFDocument.load(await extractedSingle.arrayBuffer());
  check("Quick action: extractSinglePage produces 1-page document", extractedDoc.getPageCount() === 1);
  check("Quick action: extracted single page filename indicates page number", extractedSingle.name.includes("page-3"));

  console.log("\n=================================================");
  if (failed > 0) {
    console.error(`FAILED: ${failed} test(s) failed in Phase 2 suite.`);
    process.exit(1);
  } else {
    console.log("ALL PHASE 2 CAPABILITY TESTS PASSED");
    console.log("=================================================");
  }
}

runPhase2Tests().catch((err) => {
  console.error("Unhandled error in test runner:", err);
  process.exit(1);
});

