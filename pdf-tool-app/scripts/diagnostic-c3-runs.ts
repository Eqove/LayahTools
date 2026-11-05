import fs from "fs/promises";
import path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../src/lib/document/geometry";
import { inferTextLines } from "../src/lib/document/lines";
import { inferTextRuns } from "../src/lib/document/runs";

async function runDiagnostic() {
  console.log("Starting C.3.2 Real-PDF Diagnostic...\n");
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
      const runs = inferTextRuns(lines, geometries);
      
      console.log(`- Source Text Object Count: ${textObjs.length}`);
      console.log(`- Inferred Line Count: ${lines.length}`);
      console.log(`- Inferred Run Count: ${runs.length}`);
      
      const objectsPerRun = runs.map(r => r.sourceObjectIds.length);
      const avgObjectsPerRun = (objectsPerRun.reduce((a,b) => a+b, 0) / runs.length).toFixed(1);
      console.log(`- Objects Per Run: avg ${avgObjectsPerRun}`);
      
      console.log(`\nRepresentative Runs (first 5 lines):`);
      for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const line = lines[i];
        const lineRuns = runs.filter(r => line.sourceObjectIds.includes(r.sourceObjectIds[0]));
        
        console.log(`  [Line ${i + 1}] (${lineRuns.length} runs):`);
        for (let j = 0; j < lineRuns.length; j++) {
           const run = lineRuns[j];
           const texts = run.sourceObjectIds.map(id => layahObjs.find((o: any) => o.id === id)?.text);
           const joinedText = texts.join(" ").replace(/\r?\n|\r/g, "");
           const fontData = `[size=${run.fontSize?.toFixed(1) || '?'}, wt=${run.fontWeight || '?'}, italic=${run.isItalic || '?'}]`;
           console.log(`    Run ${j+1}: ${fontData} "${joinedText}"`);
        }
      }
      console.log();
      
    } catch (e) {
      console.error(`Error processing ${file}:`, e);
    }
  }
  
  engine.dispose();
  console.log("Diagnostic complete.");
}

runDiagnostic().catch(console.error);
