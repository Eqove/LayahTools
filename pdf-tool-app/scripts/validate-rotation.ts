import fs from "fs/promises";
import path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { deriveTextGeometry } from "../src/lib/document/geometry";

async function run() {
  const fixturesDir = path.join(__dirname, "../tests/fixtures/pdfs");
  const files = await fs.readdir(fixturesDir);
  
  const wasmBinary = await fs.readFile(
    path.join(__dirname, "../node_modules/@embedpdf/pdfium/dist/pdfium.wasm")
  );
  
  const engine = new PdfEditorEngine();
  await engine.initialize(new Uint8Array(wasmBinary).buffer as ArrayBuffer);

  let rotatedFound = false;

  for (const file of files) {
    if (!file.endsWith(".pdf")) continue;
    
    try {
      const bytes = await fs.readFile(path.join(fixturesDir, file));
      await engine.load(bytes);
      
      // We will check page 0
      const textObjs = await engine.getTextObjects(0);
      const mapper = new PdfToLayahMapper();
      
      for (const t of textObjs) {
        const layahObj = mapper.mapObject(t) as any;
        const geom = deriveTextGeometry(layahObj);
        
        if (Math.abs(geom.rotationAngle) > 0.1) {
          console.log(`\nROTATED TEXT FOUND in ${file}:`);
          console.log(`  Text: "${geom.text}"`);
          console.log(`  Angle: ${geom.rotationAngle.toFixed(2)}`);
          console.log(`  Bounds:`, geom.bounds);
          rotatedFound = true;
          break; // Stop at first rotated text in this file
        }
      }
    } catch (e) {}
  }
  
  engine.dispose();
  
  if (!rotatedFound) {
    console.log("No rotated text found in existing fixtures.");
  }
}

run();
