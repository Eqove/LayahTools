import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

async function createTestPDF(outPath: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Test Engine Architecture", { x: 50, y: 350, font, size: 24, color: rgb(0,0,0) });
  page.drawText("Needs replacement", { x: 50, y: 300, font, size: 14, color: rgb(0,0,0) });
  page.drawText("Delete me", { x: 50, y: 280, font, size: 14, color: rgb(0,0,0) });
  
  // Embed a 1x1 image
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);
  const image = await doc.embedPng(pngBytes);
  page.drawImage(image, { x: 400, y: 300, width: 50, height: 50 });
  
  const bytes = await doc.save();
  await fs.writeFile(outPath, bytes);
  return bytes;
}

async function runTests() {
  console.log("=== Testing PdfEditorEngine Architecture ===");
  const testDir = path.join(__dirname, "../test-corpus");
  await fs.mkdir(testDir, { recursive: true }).catch(() => {});
  
  const originalPath = path.join(testDir, "engine-test-original.pdf");
  const mutatedPath = path.join(testDir, "engine-test-mutated.pdf");
  
  const pdfBytes = await createTestPDF(originalPath);
  console.log(`✅ Created test PDF: ${originalPath}`);

  // 1. Initialization
  const engine = new PdfEditorEngine();
  const wasmBinary = await fs.readFile(
    path.join(__dirname, "../node_modules/@embedpdf/pdfium/dist/pdfium.wasm")
  );
  await engine.initialize(new Uint8Array(wasmBinary).buffer as ArrayBuffer);
  console.log("✅ Engine initialized");

  // 2. Load
  await engine.load(pdfBytes);
  console.log("✅ Document loaded");

  // 3. Inspect
  const pageInfo = await engine.inspectPage(0);
  console.log(`✅ Inspected page 0: ${pageInfo.objectCount} objects`);

  // 4. Text Discovery
  const texts = await engine.getTextObjects(0);
  console.log(`✅ Discovered ${texts.length} text objects`);
  
  // 5. Operations
  for (const text of texts) {
    if (text.text === "Needs replacement") {
      await engine.replaceText(0, text.id, "Successfully replaced!");
      console.log(`✅ Replaced text object ${text.id}`);
    } else if (text.text === "Delete me") {
      await engine.deleteObject(0, text.id);
      console.log(`✅ Deleted text object ${text.id}`);
    } else if (text.text === "Test Engine Architecture") {
      await engine.moveObject(0, text.id, 0, -20);
      console.log(`✅ Moved text object ${text.id}`);
    }
  }

  // 6. Image Discovery
  const images = await engine.getImageObjects(0);
  console.log(`✅ Discovered ${images.length} image objects`);
  if (images.length > 0) {
    await engine.moveObject(0, images[0].id, -50, 0);
    console.log(`✅ Moved image object ${images[0].id}`);
  }

  // 7. Add new text
  const newTextId = await engine.addText(0, {
    text: "Brand new text from engine abstraction",
    x: 100,
    y: 100,
    fontFamily: "Helvetica",
    fontSize: 16
  });
  console.log(`✅ Inserted new text object: ${newTextId}`);

  // 8. Export
  const mutatedBytes = await engine.export();
  await fs.writeFile(mutatedPath, mutatedBytes);
  console.log(`✅ Exported mutated PDF: ${mutatedPath} (${mutatedBytes.length} bytes)`);

  // 9. Dispose
  engine.dispose();
  console.log("✅ Engine disposed and memory cleaned");

  // 10. Re-open validation
  const reloadedDoc = await PDFDocument.load(mutatedBytes);
  console.log(`✅ Successfully reloaded mutated bytes with pdf-lib! Pages: ${reloadedDoc.getPageCount()}`);
}

runTests().catch(console.error);
