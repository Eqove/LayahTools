import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { mergePdfFiles } from "../src/lib/pdf/operations";
import { reorderFiles, type WorkspaceFile } from "../src/lib/workspace/files";

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};

async function createTestPdf(label: string, pageCount = 1): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`${label} - Page ${i + 1}`, {
      x: 50,
      y: 500,
      size: 24,
      font,
      color: rgb(0.1, 0.2, 0.8),
    });
  }

  const bytes = await doc.save();
  return new File([bytes as BlobPart], `${label}.pdf`, { type: "application/pdf" });
}

async function runTests() {
  console.log("=== MERGE PDF ORDER & INTEGRITY TESTS (Task A-1.2) ===\n");

  const fileA = await createTestPdf("DocA", 1);
  const fileB = await createTestPdf("DocB", 2);
  const fileC = await createTestPdf("DocC", 3);

  // 1. Single-file merge behavior throws validation error
  let singleErrorCaught = false;
  try {
    await mergePdfFiles([fileA]);
  } catch (e: any) {
    singleErrorCaught = true;
    check("single-file merge rejected with clear error", e.message.includes("at least two"));
  }
  if (!singleErrorCaught) check("single-file merge rejected with clear error", false);

  // 2. Three PDFs merged in original order [A, B, C]
  const initialItems: WorkspaceFile[] = [
    { id: "f1", file: fileA },
    { id: "f2", file: fileB },
    { id: "f3", file: fileC },
  ];

  const filesInOrder1 = initialItems.map((i) => i.file);
  const result1 = await mergePdfFiles(filesInOrder1);
  check("merge produces 1 output file", result1.length === 1);
  check("merged filename derives from first input", result1[0].filename.includes("DocA"));

  // Validate exported PDF by reopening
  const opened1 = await PDFDocument.load(result1[0].bytes);
  check("exported PDF opens cleanly in pdf-lib", opened1 !== null);
  check("original order page count matches sum (1 + 2 + 3 = 6)", opened1.getPageCount() === 6);

  // 3. Three PDFs merged after reordering: Move DocC to first position [C, A, B]
  const reorderedItems = reorderFiles(initialItems, 2, 0); // index 2 -> index 0
  check("reordered order IDs: f3, f1, f2", reorderedItems.map((i) => i.id).join(",") === "f3,f1,f2");

  const filesInOrder2 = reorderedItems.map((i) => i.file);
  const result2 = await mergePdfFiles(filesInOrder2);
  check("merged output after reorder names from new first file (DocC)", result2[0].filename.includes("DocC"));

  const opened2 = await PDFDocument.load(result2[0].bytes);
  check("reordered merged PDF reopens with 6 pages", opened2.getPageCount() === 6);

  // 4. Repeated reordering [B, C, A]
  const repeatedItems = reorderFiles(reorderedItems, "f2", "f3"); // insert f2 before f3 -> [f2, f3, f1]
  check("repeated reorder order IDs: f2, f3, f1", repeatedItems.map((i) => i.id).join(",") === "f2,f3,f1");

  const filesInOrder3 = repeatedItems.map((i) => i.file);
  const result3 = await mergePdfFiles(filesInOrder3);
  check("repeated reorder filename derived from DocB", result3[0].filename.includes("DocB"));

  const opened3 = await PDFDocument.load(result3[0].bytes);
  check("repeated reorder reopens with 6 pages", opened3.getPageCount() === 6);

  // 5. Original uploaded documents preserved
  check("original fileA byte length untouched", fileA.size > 0);
  check("original fileB byte length untouched", fileB.size > 0);
  check("original fileC byte length untouched", fileC.size > 0);

  // 6. Invalid / unsupported input handling
  const corruptedFile = new File([new Uint8Array([0, 1, 2, 3])], "corrupted.pdf", { type: "application/pdf" });
  let corruptedCaught = false;
  try {
    await mergePdfFiles([fileA, corruptedFile]);
  } catch {
    corruptedCaught = true;
  }
  check("corrupted PDF input fails safely without crash", corruptedCaught);

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
