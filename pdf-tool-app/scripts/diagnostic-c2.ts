import fs from "fs/promises";
import path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { getReadingOrder, deriveTextGeometry } from "../src/lib/document/geometry";
import { LayahTextObject } from "../src/lib/document/types";

async function runDiagnostic() {
  console.log("Starting C.2 Real-PDF Diagnostic...");
  const fixturesDir = path.join(__dirname, "../tests/fixtures/pdfs");
  
  let files: string[] = [];
  try {
    files = await fs.readdir(fixturesDir);
  } catch (e) {
    console.error("Could not read fixtures directory:", e);
    return;
  }
  
  const wasmBinary = await fs.readFile(
    path.join(__dirname, "../node_modules/@embedpdf/pdfium/dist/pdfium.wasm")
  );
  
  const engine = new PdfEditorEngine();
  await engine.initialize(new Uint8Array(wasmBinary).buffer as ArrayBuffer);

  for (const file of files) {
    if (!file.endsWith(".pdf")) continue;
    console.log(`\n==================================================`);
    console.log(`Analyzing: ${file}`);
    console.log(`==================================================`);
    
    try {
      const filePath = path.join(fixturesDir, file);
      const bytes = await fs.readFile(filePath);
      
      await engine.load(bytes);
      
      // We will test page 0 layout logic
      const textObjs = await engine.getTextObjects(0);
      
      const mapper = new PdfToLayahMapper();
      const layahTextObjects = textObjs.map(t => mapper.mapObject(t) as LayahTextObject);
      
      console.log(`Page 0 - Total Text Objects: ${textObjs.length}`);
      
      if (layahTextObjects.length > 0) {
        const firstGeom = deriveTextGeometry(layahTextObjects[0]);
        console.log(`\nRepresentative Normalized Geometry (First Object):`);
        console.log(`  Text: "${firstGeom.text.substring(0, 40).replace(/\r?\n|\r/g, " ")}"`);
        console.log(`  Bounds: left: ${firstGeom.bounds.left.toFixed(2)}, bottom: ${firstGeom.bounds.bottom.toFixed(2)}, right: ${firstGeom.bounds.right.toFixed(2)}, top: ${firstGeom.bounds.top.toFixed(2)}`);
        console.log(`  Center: (${firstGeom.centerX.toFixed(2)}, ${firstGeom.centerY.toFixed(2)})`);
        console.log(`  Rotation: ${firstGeom.rotationAngle.toFixed(2)} degrees`);
        
        const rotations = new Set(layahTextObjects.map(o => deriveTextGeometry(o).rotationAngle.toFixed(1)));
        console.log(`\nDetected Rotations (Degrees):`, Array.from(rotations));
        
        const orderResult = getReadingOrder(layahTextObjects);
        console.log(`\nReading Order Confidence: ${orderResult.confidence}`);
        console.log(`Reasons/Regions:`);
        orderResult.reasons.forEach(r => console.log(`  - ${r}`));
        
        console.log(`\nReading Order Sample (First 10 items):`);
        orderResult.orderedObjectIds.slice(0, 10).forEach(id => {
          const obj = layahTextObjects.find(o => o.id === id);
          if (obj) {
             const geom = deriveTextGeometry(obj);
             console.log(`  [${id}] Y:${geom.centerY.toFixed(1)} X:${geom.centerX.toFixed(1)} | "${obj.text.replace(/\r?\n|\r/g, " ")}"`);
          }
        });
      }
    } catch (e) {
      console.error(`Error processing ${file}:`, e);
    }
  }
  
  engine.dispose();
  console.log("\nDiagnostic complete.");
}

runDiagnostic().catch(console.error);
