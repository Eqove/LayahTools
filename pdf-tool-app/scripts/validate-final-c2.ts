import { PDFDocument, rgb, degrees } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../src/lib/document/geometry";

async function runValidations() {
  const testDir = path.join(__dirname, "../test-corpus");
  await fs.mkdir(testDir, { recursive: true }).catch(() => {});
  
  const syntheticPath = path.join(testDir, "c2-final-validation.pdf");
  
  // Create synthetic PDF using pdf-lib
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);

  // 1. Draw Two Columns OUT OF ORDER in the PDF content stream
  // Left column: X=50, Y=700, 680, 660, 640
  // Right column: X=300, Y=700, 680, 660, 640
  
  // R4
  page.drawText("R4", { x: 300, y: 640, size: 12 });
  // L2
  page.drawText("L2", { x: 50, y: 680, size: 12 });
  // R1
  page.drawText("R1", { x: 300, y: 700, size: 12 });
  // L1
  page.drawText("L1", { x: 50, y: 700, size: 12 });
  // R2
  page.drawText("R2", { x: 300, y: 680, size: 12 });
  // L4
  page.drawText("L4", { x: 50, y: 640, size: 12 });
  // L3
  page.drawText("L3", { x: 50, y: 660, size: 12 });
  // R3
  page.drawText("R3", { x: 300, y: 660, size: 12 });
  
  // 2. Draw Rotated Text
  page.drawText("RotatedText", { x: 500, y: 400, size: 12, rotate: degrees(90) });

  const bytes = await doc.save();
  await fs.writeFile(syntheticPath, bytes);
  
  console.log("Synthetic PDF generated.");

  // Process with Pipeline
  const wasmBinary = await fs.readFile(
    path.join(__dirname, "../node_modules/@embedpdf/pdfium/dist/pdfium.wasm")
  );
  
  const engine = new PdfEditorEngine();
  await engine.initialize(new Uint8Array(wasmBinary).buffer as ArrayBuffer);
  await engine.load(bytes);
  
  const textObjs = await engine.getTextObjects(0);
  const mapper = new PdfToLayahMapper();
  const layahObjs = textObjs.map(t => mapper.mapObject(t) as any);
  
  console.log(`\n=== A. TWO-COLUMN VALIDATION ===`);
  const orderResult = getReadingOrder(layahObjs);
  
  console.log(layahObjs.map(o => o.text)); const twoColTexts = orderResult.orderedObjectIds
    .map(id => layahObjs.find((o: any) => o.id === id)?.text?.trim())
    .filter(t => t && t.length === 2 && (t.startsWith("L") || t.startsWith("R")));
    
  console.log("Expected Order: L1, L2, L3, L4, R1, R2, R3, R4");
  console.log("Actual Order:  ", twoColTexts.join(", "));
  
  if (twoColTexts.join() === "L1,L2,L3,L4,R1,R2,R3,R4") {
    console.log("✅ Passed: Clean two-column layout parsed flawlessly.");
  } else {
    console.log("❌ Failed to parse two-column reading order.");
  }

  console.log(`\n=== B. ROTATION VALIDATION ===`);
  const rotatedObj = layahObjs.find((o: any) => o.text === "RotatedText");
  if (rotatedObj) {
    const geom = deriveTextGeometry(rotatedObj);
    console.log("Detected Object: RotatedText");
    console.log(`Angle: ${geom.rotationAngle.toFixed(2)} degrees`);
    console.log("Bounds:", geom.bounds);
    console.log(`Overall Reading Confidence: ${orderResult.confidence}`);
    
    if (Math.abs(geom.rotationAngle - 90) < 1 && orderResult.confidence === "medium") {
      console.log("✅ Passed: Rotation detected, bounding box valid, confidence degraded gracefully to 'medium'.");
    } else {
      console.log("❌ Failed: Rotation not properly recognized or confidence unadjusted.");
    }
  } else {
    console.log("❌ Failed: RotatedText object not found.");
  }
  
  engine.dispose();
}

runValidations().catch(console.error);
