import fs from "fs/promises";
import path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../src/lib/document/geometry";
import { inferTextLines } from "../src/lib/document/lines";
import { inferTextBlocks } from "../src/lib/document/blocks";

async function runDiagnostic() {
  console.log("Starting C.3.3 Real-PDF Diagnostic...\n");
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
      const blocks = inferTextBlocks(lines);
      
      console.log(`- Source Text Object Count: ${textObjs.length}`);
      console.log(`- Inferred Line Count: ${lines.length}`);
      console.log(`- Inferred Block Count: ${blocks.length}`);
      
      const linesPerBlock = blocks.map(b => b.lineIds.length);
      const avgLinesPerBlock = (linesPerBlock.reduce((a,b) => a+b, 0) / blocks.length).toFixed(1);
      console.log(`- Lines Per Block: avg ${avgLinesPerBlock}, max ${Math.max(...linesPerBlock)}`);
      
      console.log(`\nRepresentative Blocks (first 3):`);
      for (let i = 0; i < Math.min(blocks.length, 3); i++) {
        const block = blocks[i];
        console.log(`  [Block ${i + 1}] (${block.lineIds.length} lines):`);
        
        // Print lines in this block
        for (let j = 0; j < block.lineIds.length; j++) {
           const lineId = block.lineIds[j];
           const line = lines.find(l => l.id === lineId);
           if (!line) continue;
           
           const texts = line.sourceObjectIds.map(id => layahObjs.find((o: any) => o.id === id)?.text);
           const joinedText = texts.join(" ").replace(/\r?\n|\r/g, "");
           console.log(`    Line ${j+1}: "${joinedText}"`);
        }
        console.log();
      }
      
    } catch (e) {
      console.error(`Error processing ${file}:`, e);
    }
  }
  
  engine.dispose();
  console.log("Diagnostic complete.");
}

runDiagnostic().catch(console.error);
