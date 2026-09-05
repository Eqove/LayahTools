import { 
  LayahSourceObject, 
  LayahTextObject,
  LayahDocument
} from "../src/lib/document/types";
import { 
  reconcileDocuments, 
  reconcilePageObjects 
} from "../src/lib/document/identity";

function createText(id: string, text: string, bounds: any): LayahTextObject {
  return {
    id,
    type: "text",
    pageIndex: 0,
    text,
    bounds,
    transform: { a: 1, b: 0, c: 0, d: 1, e: bounds.left, f: bounds.bottom },
    provenance: { kind: "source" }
  };
}

function runTests() {
  console.log("=== Testing Object Identity & Reconciliation ===");

  // 1. IDENTICAL MODEL
  const objA = createText("page-0-text-1", "Hello World", { left: 10, bottom: 10, right: 100, top: 20 });
  const oldDoc1 = { "page-0-text-1": objA };
  const newDoc1 = { "page-0-text-1": { ...objA } };
  
  const report1 = reconcilePageObjects(oldDoc1, newDoc1);
  if (report1.matched.length === 1 && report1.matched[0].confidence === "derived") {
    console.log("✅ IDENTICAL MODEL: Successfully matched with derived confidence.");
  } else {
    console.error("❌ IDENTICAL MODEL FAILED", report1);
  }

  // 2. CONTENT CHANGE (Same geometry, different text)
  const objB = createText("page-0-text-1", "Hello Layah", { left: 10, bottom: 10, right: 100, top: 20 });
  const newDoc2 = { "page-0-text-1": objB };
  const report2 = reconcilePageObjects(oldDoc1, newDoc2);
  if (report2.matched.length === 1 && report2.matched[0].reason.includes("mutated content")) {
    console.log("✅ CONTENT CHANGE: Recognized same object despite content mutation.");
  } else {
    console.error("❌ CONTENT CHANGE FAILED", report2);
  }

  // 3. POSITION CHANGE (Same unique text, different geometry)
  const objC = createText("page-0-text-2", "Hello World", { left: 15, bottom: 15, right: 105, top: 25 });
  const newDoc3 = { "page-0-text-2": objC };
  const report3 = reconcilePageObjects(oldDoc1, newDoc3);
  if (report3.matched.length === 1 && report3.matched[0].reason.includes("Unique text")) {
    console.log("✅ POSITION CHANGE: Recognized same object via unique text.");
  } else {
    console.error("❌ POSITION CHANGE FAILED", report3);
  }

  // 4. NEW OBJECT (Added)
  const newDoc4 = { 
    "page-0-text-1": { ...objA },
    "page-0-text-2": createText("page-0-text-2", "New Obj", { left: 50, bottom: 50, right: 80, top: 60 })
  };
  const report4 = reconcilePageObjects(oldDoc1, newDoc4);
  if (report4.matched.length === 1 && report4.added.length === 1) {
    console.log("✅ NEW OBJECT: Successfully identified added object.");
  } else {
    console.error("❌ NEW OBJECT FAILED", report4);
  }

  // 5. DELETED OBJECT (Removed)
  const oldDoc5 = { 
    "page-0-text-1": { ...objA },
    "page-0-text-2": createText("page-0-text-2", "To Be Deleted", { left: 50, bottom: 50, right: 80, top: 60 })
  };
  const newDoc5 = { "page-0-text-1": { ...objA } }; // Object 2 missing
  const report5 = reconcilePageObjects(oldDoc5, newDoc5);
  if (report5.removed.includes("page-0-text-2")) {
    console.log("✅ DELETED OBJECT: Successfully identified removed object.");
  } else {
    console.error("❌ DELETED OBJECT FAILED", report5);
  }

  // 6. AMBIGUITY (Multiple overlaps without exact matching)
  const ambigA = createText("page-0-text-1", "Duplicate", { left: 10, bottom: 10, right: 100, top: 20 });
  const oldDoc6 = { "page-0-text-1": ambigA };
  
  // Two new objects completely overlapping the old one area (spatially matching)
  const ambigNew1 = createText("page-0-text-1", "Diff1", { left: 10, bottom: 10, right: 100, top: 20 });
  const ambigNew2 = createText("page-0-text-2", "Diff2", { left: 12, bottom: 12, right: 98, top: 18 });
  
  const report6 = reconcilePageObjects(oldDoc6, { 
    "page-0-text-1": ambigNew1, 
    "page-0-text-2": ambigNew2 
  });
  
  // Both match exact bounds (ambigNew1) or overlap (ambigNew2). 
  // Wait, ambigNew1 exact bounds matches, which is a stronger signal (Pass 3).
  // Let's force an overlap ambiguity by tweaking both bounds slightly.
  const ambigNew3 = createText("page-0-text-3", "Diff3", { left: 11, bottom: 11, right: 99, top: 19 });
  const report6b = reconcilePageObjects(oldDoc6, { 
    "page-0-text-2": ambigNew2, 
    "page-0-text-3": ambigNew3 
  });
  
  if (report6b.uncertain.length === 1 && report6b.uncertain[0].oldId === "page-0-text-1") {
    console.log("✅ AMBIGUITY: Handled multiple plausible spatial overlaps as uncertain.");
  } else {
    console.error("❌ AMBIGUITY FAILED", report6b);
  }

  // 7. TYPE SAFETY (Text shouldn't match Image even if bounds overlap)
  const imgObj = {
    id: "page-0-image-1",
    type: "image" as const,
    pageIndex: 0,
    bounds: { left: 11, bottom: 11, right: 99, top: 19 },
    transform: null,
    provenance: { kind: "source" as const }
  };
  const report7 = reconcilePageObjects(oldDoc6, { "page-0-image-1": imgObj });
  if (report7.matched.length === 0 && report7.removed.length === 1 && report7.added.length === 1) {
    console.log("✅ TYPE SAFETY: Ignored overlap between different object types.");
  } else {
    console.error("❌ TYPE SAFETY FAILED", report7);
  }

  // 8. FULL DOCUMENT RECONCILIATION
  const docA: LayahDocument = {
    id: "doc-1",
    metadata: {},
    pages: { 0: { id: "page-0", pageIndex: 0, width: 600, height: 800, objects: oldDoc1, layout: { textBlocks: {}, runs: {} } } }
  };
  const docB: LayahDocument = {
    id: "doc-1",
    metadata: {},
    pages: { 0: { id: "page-0", pageIndex: 0, width: 600, height: 800, objects: newDoc2, layout: { textBlocks: {}, runs: {} } } }
  };
  const docReport = reconcileDocuments(docA, docB);
  if (docReport.matched.length === 1) {
    console.log("✅ FULL DOCUMENT: Page mapping resolved successfully.");
  }

  // 9. SERIALIZATION
  try {
    JSON.stringify(docReport);
    console.log("✅ SERIALIZATION: Reconciliation report is purely JSON serializable.");
  } catch (e) {
    console.error("❌ SERIALIZATION FAILED", e);
  }
}

runTests();
