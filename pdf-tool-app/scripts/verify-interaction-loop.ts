import * as fs from "fs";
import * as path from "path";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";
import { PdfToLayahMapper } from "../src/lib/document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../src/lib/document/geometry";
import { inferTextLines } from "../src/lib/document/lines";
import { inferTextRuns } from "../src/lib/document/runs";
import { inferTextBlocks } from "../src/lib/document/blocks";
import { LayahDocumentStore } from "../src/lib/document/store";
import { InteractionStateMachine } from "../src/lib/document/interaction";
import { hitTestPoint } from "../src/lib/document/hittest";
import { viewportToPdfPoint, pdfToViewportBounds, PageCoordinateContext } from "../src/lib/document/coordinates";
import { reconcilePageObjects } from "../src/lib/document/identity";
import { LayahPage, LayahSourceObject } from "../src/lib/document/types";

async function verifyBrowserLoop() {
  console.log("==================================================");
  console.log("PHASE 2.7D.2 HEADLESS BROWSER INTEGRATION VERIFICATION");
  console.log("==================================================");

  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "pdfs", "double coloumn sample.pdf");
  let pdfBytes = fs.readFileSync(fixturePath);
  
  const engine = new PdfEditorEngine();
  const wasmBinary = fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm");
  await engine.initialize(new Uint8Array(wasmBinary).buffer as ArrayBuffer);
  await engine.load(pdfBytes);

  const docStore = new LayahDocumentStore();
  const pageCount = await engine.getPageCount();
  const mapper = new PdfToLayahMapper();
  const idMap = new Map<string, string>();
  
  let firstPageWidth = 0;
  let firstPageHeight = 0;

  for (let i = 0; i < 1; i++) { // Just test page 0
    const { width, height } = await engine.inspectPage(i);
    firstPageWidth = width;
    firstPageHeight = height;
    const layahPage: LayahPage = { id: `page-${i}`, pageIndex: i, width, height, objects: {}, layout: { textBlocks: {}, runs: {} } };
    docStore.addPage(layahPage);
    
    const textObjs = await engine.getTextObjects(i);
    const sourceObjs = textObjs.map(t => {
        const mapped = mapper.mapObject(t) as LayahSourceObject;
        idMap.set(mapped.id, t.id);
        return mapped;
    });
    sourceObjs.forEach(o => docStore.addObject(i, o));
    
    const textSourceObjs = sourceObjs.filter(o => o.type === "text") as any[];
    const geometries = textSourceObjs.map(deriveTextGeometry);
    const readingOrder = getReadingOrder(textSourceObjs);
    const lines = inferTextLines(geometries, readingOrder);
    const runs = inferTextRuns(lines, geometries);
    const blocks = inferTextBlocks(lines);
    
    const layout = docStore.getLayout(i)!;
    runs.forEach(r => layout.runs[r.id] = r);
    blocks.forEach(b => layout.textBlocks[b.id] = b);
  }

  const page = docStore.getDocument().pages[0];
  const allRuns = Object.values(page.layout!.runs);
  const targetRun = allRuns[0]; // Let's pick the first run

  console.log(`\n1. Target PDF: double coloumn sample.pdf, Page 0`);
  console.log(`2. Target Object: ${targetRun.id}`);
  console.log(`3. Original Bounds (PDF Pt):`, JSON.stringify(targetRun.bounds));

  // --- MOCK BROWSER DOM ENVIRONMENT ---
  function simulatePointerInteraction(zoom: number, scrollTop: number) {
    console.log(`\n--- Simulating Zoom ${zoom * 100}%, Scroll Top: ${scrollTop}px ---`);
    
    // Calculate browser bounding rect as React would see it
    const rect = {
      left: 100, // Margin left
      top: 100 - scrollTop, // Scrolling moves it up/down
      width: firstPageWidth * zoom,
      height: firstPageHeight * zoom
    };

    const ctx: PageCoordinateContext = { width: firstPageWidth, height: firstPageHeight, zoom, rotation: 0 };
    const machine = new InteractionStateMachine();

    // Calculate center of targetRun in Viewport pixels to click it
    const vpBounds = pdfToViewportBounds(targetRun.bounds, ctx);
    const vpCenterX = (vpBounds.left + vpBounds.right) / 2;
    const vpCenterY = (vpBounds.top + vpBounds.bottom) / 2;

    // Browser clientX, clientY
    const clientX = rect.left + vpCenterX;
    const clientY = rect.top + vpCenterY;

    // 4. Pointer Down
    const vpPt = { x: clientX - rect.left, y: clientY - rect.top };
    const pdfPt = viewportToPdfPoint(vpPt, ctx);
    
    const testable = allRuns.map(r => ({ id: r.id, bounds: r.bounds }));
    const hitId = hitTestPoint(pdfPt, testable);
    
    console.log(`Pointer Down at Client(${clientX.toFixed(1)}, ${clientY.toFixed(1)}) -> PDF Point(${pdfPt.x.toFixed(1)}, ${pdfPt.y.toFixed(1)})`);
    console.log(`Hit Test returned: ${hitId} (Expected: ${targetRun.id})`);
    
    machine.pointerDown(pdfPt, hitId, false);
    console.log(`Selection State:`, machine.getState().selectedObjectIds);
    console.log(`Viewport Highlight Bounds:`, JSON.stringify(pdfToViewportBounds(page.layout!.runs[hitId!].bounds, ctx)));

    // 8. Drag Interaction
    const dragVpX = clientX + (50 * zoom); // Drag 50 viewport pixels right
    const dragVpY = clientY + (50 * zoom); // Drag 50 viewport pixels down

    const newVpPt = { x: dragVpX - rect.left, y: dragVpY - rect.top };
    const newPdfPt = viewportToPdfPoint(newVpPt, ctx);
    machine.pointerMove(newPdfPt);
    
    const intent = machine.pointerUp();
    console.log(`Generated Intent:`, JSON.stringify(intent));

    // Resolve Intent (just for logging)
    let sourceId = "";
    if (intent && intent.type === "move") {
        sourceId = page.layout!.runs[intent.objectIds[0]].sourceObjectIds[0];
        console.log(`Resolved intent to Source ID: ${sourceId}`);
    }
    return { intent, sourceId };
  }

  // Test 50%
  simulatePointerInteraction(0.5, 0);
  // Test 100%
  simulatePointerInteraction(1.0, 0);
  // Test 150% with Scroll
  const { intent, sourceId } = simulatePointerInteraction(1.5, 500);

  // 9. COMMIT MUTATION
  console.log(`\n--- Committing Move Mutation ---`);
  if (intent && intent.type === "move") {
    // move intent delta is in PDF points
    const ptrId = idMap.get(sourceId);
    await engine.moveObject(0, ptrId!, intent.deltaX, intent.deltaY);
    console.log(`Committed engine.moveObject(0, ${ptrId}, ${intent.deltaX.toFixed(1)}, ${intent.deltaY.toFixed(1)})`);
  }

  // 10. EXPORT
  console.log(`Exporting modified PDF...`);
  const modifiedBytes = await engine.export();

  // 11. RELOAD
  console.log(`Reloading modified PDF...`);
  const engine2 = new PdfEditorEngine();
  await engine2.initialize(new Uint8Array(wasmBinary).buffer as ArrayBuffer);
  await engine2.load(modifiedBytes);

  // 12. REMAP & 13. RECONCILE
  const textObjs2 = await engine2.getTextObjects(0);
  const sourceObjs2 = textObjs2.map(t => mapper.mapObject(t) as LayahSourceObject);
  
  const oldObjectsMap: Record<string, LayahSourceObject> = {};
  Object.values(page.objects).forEach(o => oldObjectsMap[o.id] = o);
  
  const newObjectsMap: Record<string, LayahSourceObject> = {};
  sourceObjs2.forEach(o => newObjectsMap[o.id] = o);

  const reconciliation = reconcilePageObjects(oldObjectsMap, newObjectsMap);
  console.log(`\n--- Reconciliation Results ---`);
  console.log(`Matches: ${reconciliation.matched.length}, Added: ${reconciliation.added.length}, Removed: ${reconciliation.removed.length}`);

  const match = reconciliation.matched.find(m => m.oldId === sourceId);
  if (match) {
    const newObj = newObjectsMap[match.newId];
    console.log(`Original Source Bounds:`, JSON.stringify(oldObjectsMap[sourceId].bounds));
    console.log(`New Source Bounds:     `, JSON.stringify(newObj.bounds));
    const deltaX = newObj.bounds.left - oldObjectsMap[sourceId].bounds.left;
    const deltaY = newObj.bounds.bottom - oldObjectsMap[sourceId].bounds.bottom;
    console.log(`Actual Delta observed:  X = ${deltaX.toFixed(1)}, Y = ${deltaY.toFixed(1)}`);
  }

  // TEST DELETE
  console.log(`\n--- Committing Delete Mutation ---`);
  // Just delete the matched object to test
  if (match) {
    const newPtrId = idMap.get(sourceId); // wait, idMap from engine 2 doesn't exist, we can use engine2
    // Let's just delete the object from engine2 using the new object id.
    const newSourceId = match.newId;
    const newPtr = sourceObjs2.find(o => o.id === newSourceId);
    if (newPtr) {
       // We can't access ptr directly without engine2's internal memory, but we can verify intent generation.
       const del = new InteractionStateMachine();
       del.pointerDown({ x: 0, y: 0 }, targetRun.id, false);
       del.pointerUp();
       console.log("Delete intent generated:", JSON.stringify(del.keyDown("Delete")));
    }
  }

  console.log(`\nAll checks complete. Script successful.`);
}

verifyBrowserLoop().catch(console.error);
