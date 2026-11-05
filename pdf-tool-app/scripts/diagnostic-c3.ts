import fs from "fs/promises";
import path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../src/lib/document/geometry";
import { inferTextLines } from "../src/lib/document/lines";

async function runDiagnostic() {
  console.log("Starting C.3.1 Real-PDF Diagnostic...\n");
  const fixturesDir = path.join(__dirname, "../tests/fixtures/pdfs");
  const files = await fs.readdir(fixturesDir).catch(() => []);
  
  const wasmPath = path.join(__dirname, "../node_modules/@embedpdf/pdfium/dist/pdfium.wasm");
  const wasmBinary = await fs.readFile(wasmPath);
  
  const engine = new PdfEditorEngine();
  await engine.initialize(new Uint8Array(wasmBinary).buffer as ArrayBuffer);

  for (const file of files) {
    if (!file.endsWith(".pdf")) continue;
    console.log(`==================================================`);
    console.log(`Analyzing: ${file}`);
    console.log(`==================================================`);
    
    try {
      const bytes = await fs.readFile(path.join(fixturesDir, file));
      await engine.load(bytes);
      
      const pageIndex = 0;
      const textObjs = await engine.getTextObjects(pageIndex);
      
      const mapper = new PdfToLayahMapper();
      const layahObjs = textObjs.map(t => mapper.mapObject(t) as any);
      
      const geometries = layahObjs.map(deriveTextGeometry);
      const readingOrder = getReadingOrder(layahObjs);
      
      const lines = inferTextLines(geometries, readingOrder);
      
      console.log(`- Page Tested: ${pageIndex}`);
      console.log(`- Source Text Object Count: ${textObjs.length}`);
      console.log(`- Inferred Line Count: ${lines.length}`);
      
      const confDist = { high: 0, medium: 0, low: 0 };
      lines.forEach(l => confDist[l.confidence]++);
      console.log(`- Confidence Distribution: ${JSON.stringify(confDist)}`);
      
      const objectsPerLine = lines.map(l => l.sourceObjectIds.length);
      const avgObjectsPerLine = (objectsPerLine.reduce((a,b) => a+b, 0) / lines.length).toFixed(1);
      const maxObjectsPerLine = Math.max(...objectsPerLine);
      console.log(`- Objects Per Line: avg ${avgObjectsPerLine}, max ${maxObjectsPerLine}`);
      
      console.log(`\nRepresentative Lines (first 5):`);
      lines.slice(0, 5).forEach((line, idx) => {
        // Construct display text simply by joining for diagnostic purposes
        const texts = line.sourceObjectIds.map(id => layahObjs.find((o: any) => o.id === id)?.text);
        const joinedText = texts.join(" ").replace(/\r?\n|\r/g, "");
        console.log(`  [Line ${idx + 1}] (${line.sourceObjectIds.length} objs): "${joinedText}"`);
      });
      console.log();
      
    } catch (e) {
      console.error(`Error processing ${file}:`, e);
    }
  }
  
  engine.dispose();
  console.log("Diagnostic complete.");
}

runDiagnostic().catch(console.error);
