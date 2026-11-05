import fs from "fs/promises";
import path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../src/lib/document/geometry";
import { inferTextLines } from "../src/lib/document/lines";
import { inferTextRuns } from "../src/lib/document/runs";
import { inferTextBlocks } from "../src/lib/document/blocks";
import { validateDocumentModel } from "../src/lib/document/validation";
import { reconcilePageObjects } from "../src/lib/document/identity";
import { LayahSourceObject, LayahTextObject } from "../src/lib/document/types";

async function runDiagnostic() {
  console.log("Starting C.4 Real-PDF Validation...\n");
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
      const layahObjs = textObjs.map(t => mapper.mapObject(t) as LayahSourceObject);
      
      const layahTextObjs = layahObjs.filter(o => o.type === "text") as LayahTextObject[];
      const geometries = layahTextObjs.map(deriveTextGeometry);
      const readingOrder = getReadingOrder(layahTextObjs);
      const lines = inferTextLines(geometries, readingOrder);
      const runs = inferTextRuns(lines, geometries);
      const blocks = inferTextBlocks(lines);
      
      const report = validateDocumentModel(layahObjs, lines, runs, blocks);
      
      console.log(`- Model Valid: ${report.valid}`);
      console.log(`- Validation Stats: ${JSON.stringify(report.stats)}`);
      
      if (!report.valid) {
        console.error("- Validation ERRORS:");
        report.issues.filter(i => i.level === "error").forEach(err => {
           console.error(`  [${err.code}] Node ${err.nodeId}: ${err.message}`);
        });
      }
      
      const warnings = report.issues.filter(i => i.level === "warning");
      if (warnings.length > 0) {
        console.warn(`- Validation WARNINGS (${warnings.length}):`);
        // Just print the first few
        warnings.slice(0, 3).forEach(warn => {
           console.warn(`  [${warn.code}] Node ${warn.nodeId}: ${warn.message}`);
        });
      }
      
      // Quick reconciliation test (mutate slightly and test identity layer)
      const layahObjsMutated = textObjs.map(t => mapper.mapObject(t) as LayahSourceObject);
      // Remove one, modify one
      if (layahObjsMutated.length > 2) {
         layahObjsMutated.shift(); // remove first
         if (layahObjsMutated[0].type === "text") {
            (layahObjsMutated[0] as any).text += " mutation";
         }
      }
      
      const oldMap = layahObjs.reduce((acc, o) => { acc[o.id] = o; return acc; }, {} as Record<string, LayahSourceObject>);
      const newMap = layahObjsMutated.reduce((acc, o) => { acc[o.id] = o; return acc; }, {} as Record<string, LayahSourceObject>);
      const recon = reconcilePageObjects(oldMap, newMap);
      console.log(`- Reconciliation: ${recon.matched.length} matched, ${recon.added.length} added, ${recon.removed.length} removed.`);
      
    } catch (e) {
      console.error(`Error processing ${file}:`, e);
    }
  }
  
  engine.dispose();
  console.log("Diagnostic complete.");
}

runDiagnostic().catch(console.error);
