import { LayahTextObject } from "../src/lib/document/types";
import { LayahTextLine } from "../src/lib/document/lines";
import { LayahTextBlock } from "../src/lib/document/blocks";
import { LayahTextRun } from "../src/lib/document/runs";
import { validateDocumentModel } from "../src/lib/document/validation";

function runTests() {
  console.log("=== Testing Phase 2.7C.4: Document Validation ===\n");
  let passed = 0;
  let total = 0;

  function assertEqual(name: string, actual: any, expected: any) {
    total++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.error(`❌ ${name}`);
      console.error(`   Expected: ${JSON.stringify(expected)}`);
      console.error(`   Actual:   ${JSON.stringify(actual)}`);
    }
  }

  const s1: LayahTextObject = {
    id: "s1", type: "text", pageIndex: 0, text: "Hello",
    bounds: { left: 10, bottom: 100, right: 50, top: 110 },
    transform: null,
    provenance: { kind: "source" }
  };
  const s2: LayahTextObject = {
    id: "s2", type: "text", pageIndex: 0, text: "World",
    bounds: { left: 60, bottom: 100, right: 100, top: 110 },
    transform: null,
    provenance: { kind: "source" }
  };

  const line1: LayahTextLine = {
    id: "l1", pageIndex: 0, confidence: "high",
    bounds: { left: 10, bottom: 100, right: 100, top: 110 },
    sourceObjectIds: ["s1", "s2"]
  };

  const run1: LayahTextRun = {
    id: "r1", pageIndex: 0,
    bounds: { left: 10, bottom: 100, right: 100, top: 110 },
    sourceObjectIds: ["s1", "s2"]
  };

  const block1: LayahTextBlock = {
    id: "b1", pageIndex: 0, confidence: "high",
    bounds: { left: 10, bottom: 100, right: 100, top: 110 },
    lineIds: ["l1"]
  };

  // 1. Valid Model
  const validReport = validateDocumentModel([s1, s2], [line1], [run1], [block1]);
  assertEqual("Valid model passes validation", validReport.valid, true);
  assertEqual("No issues on valid model", validReport.issues.length, 0);
  assertEqual("Stats calculated correctly", validReport.stats.orphanedSourceCount, 0);

  // 2. Missing Reference (Hierarchy Integrity)
  const blockBroken: LayahTextBlock = { ...block1, lineIds: ["l999"] };
  const report2 = validateDocumentModel([s1, s2], [line1], [run1], [blockBroken]);
  assertEqual("Detects missing line reference", report2.valid, false);
  assertEqual("Error code MISSING_LINE_REF", report2.issues[0].code, "MISSING_LINE_REF");

  // 3. Geometry Integrity (Broken Bounds)
  const lineBroken: LayahTextLine = { ...line1, bounds: { left: 200, bottom: 100, right: 100, top: 110 } }; // left > right
  const report3 = validateDocumentModel([s1, s2], [lineBroken], [run1], [block1]);
  assertEqual("Detects invalid bounds", report3.valid, false);
  assertEqual("Error code INVALID_WIDTH", report3.issues[0].code, "INVALID_WIDTH");

  // 4. Geometry Escaped (Line doesn't contain source)
  const lineEscaped: LayahTextLine = { ...line1, bounds: { left: 30, bottom: 100, right: 100, top: 110 } }; // misses s1's left=10
  const report4 = validateDocumentModel([s1, s2], [lineEscaped], [run1], [block1]);
  assertEqual("Detects escaped source geometry", report4.valid, false);
  assertEqual("Error code GEOMETRY_ESCAPED", report4.issues[0].code, "GEOMETRY_ESCAPED");

  // 5. Page Consistency
  const s2Page1: LayahTextObject = { ...s2, pageIndex: 1 };
  const report5 = validateDocumentModel([s1, s2Page1], [line1], [run1], [block1]);
  assertEqual("Detects cross-page references", report5.valid, false);
  assertEqual("Error code PAGE_INCONSISTENCY", report5.issues[0].code, "PAGE_INCONSISTENCY");

  // 6. Duplicate IDs
  const report6 = validateDocumentModel([s1, s1], [line1], [run1], [block1]);
  assertEqual("Detects duplicate source IDs", report6.valid, false);
  assertEqual("Error code DUPLICATE_ID", report6.issues[0].code, "DUPLICATE_ID");

  // 7. Orphaned Source (Coverage)
  const report7 = validateDocumentModel([s1, s2], [], [], []);
  assertEqual("Detects orphaned source (valid but warns)", report7.valid, true);
  assertEqual("Warning code ORPHANED_SOURCE", report7.issues[0].code, "ORPHANED_SOURCE");
  assertEqual("Orphan count is 2", report7.stats.orphanedSourceCount, 2);

  console.log(`\nTests Completed: ${passed}/${total} Passed.`);
  if (passed !== total) process.exit(1);
}

runTests();
