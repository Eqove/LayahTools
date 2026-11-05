import { LayahTextObject } from "../src/lib/document/types";
import { 
  deriveTextGeometry, 
  getReadingOrder, 
  TextGeometryOptions 
} from "../src/lib/document/geometry";

function createMockText(id: string, text: string, bounds: any, transform?: any): LayahTextObject {
  return {
    id,
    type: "text",
    pageIndex: 0,
    text,
    bounds,
    transform: transform || { a: 1, b: 0, c: 0, d: 1, e: bounds.left, f: bounds.bottom },
    provenance: { kind: "source" }
  };
}

function runTests() {
  console.log("=== Testing Phase 2.7C.2: Text Geometry & Reading Order ===\n");
  let passed = 0;
  let total = 0;

  function assertEqual(testName: string, actual: any, expected: any) {
    total++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      console.log(`✅ ${testName}`);
      passed++;
    } else {
      console.error(`❌ ${testName}`);
      console.error(`   Expected: ${JSON.stringify(expected)}`);
      console.error(`   Actual:   ${JSON.stringify(actual)}`);
    }
  }

  // 1. GEOMETRY NORMALIZATION
  const t1 = createMockText("t1", "Hello", { left: 10, bottom: 20, right: 60, top: 40 });
  const geom1 = deriveTextGeometry(t1);
  assertEqual("Normalization: Width correctly calculated", geom1.width, 50);
  assertEqual("Normalization: Height correctly calculated", geom1.height, 20);
  assertEqual("Normalization: centerX correctly calculated", geom1.centerX, 35);
  assertEqual("Normalization: centerY correctly calculated", geom1.centerY, 30);
  assertEqual("Normalization: Rotation defaults to 0", geom1.rotationAngle, 0);

  const t2_rotated = createMockText("t2", "Rotated", { left: 10, bottom: 10, right: 20, top: 20 }, { a: 0, b: 1, c: -1, d: 0, e: 10, f: 10 });
  const geom2 = deriveTextGeometry(t2_rotated);
  assertEqual("Normalization: Rotation 90deg derived from transform", geom2.rotationAngle, 90);

  // 2. SINGLE TEXT OBJECT
  const resSingle = getReadingOrder([t1]);
  assertEqual("Reading Order: Single Object", resSingle.orderedObjectIds, ["t1"]);

  // 3. MULTIPLE OBJECTS ON ONE LINE (Left-to-Right)
  // Input deliberately out of order (right word first, then middle, then left)
  const lineObj1 = createMockText("word3", "right", { left: 100, bottom: 20, right: 140, top: 40 });
  const lineObj2 = createMockText("word2", "middle", { left: 60, bottom: 20, right: 90, top: 40 });
  const lineObj3 = createMockText("word1", "left", { left: 10, bottom: 20, right: 50, top: 40 });
  const resLine = getReadingOrder([lineObj1, lineObj2, lineObj3]);
  assertEqual("Reading Order: Same Line (Left to Right)", resLine.orderedObjectIds, ["word1", "word2", "word3"]);

  // 4. MULTIPLE LINES (Top-to-Bottom)
  // PDF coordinates: higher Y = Top
  const rowObj1 = createMockText("line2", "Line 2", { left: 10, bottom: 50, right: 100, top: 70 });
  const rowObj2 = createMockText("line1", "Line 1", { left: 10, bottom: 100, right: 100, top: 120 });
  const rowObj3 = createMockText("line3", "Line 3", { left: 10, bottom: 10, right: 100, top: 30 });
  const resRow = getReadingOrder([rowObj1, rowObj2, rowObj3]);
  assertEqual("Reading Order: Multiple Lines (Top to Bottom)", resRow.orderedObjectIds, ["line1", "line2", "line3"]);

  // 5. TWO COLUMNS AWARENESS
  // Column 1 (Left): Top = 200, Bottom = 100.
  // Column 2 (Right): Top = 200, Bottom = 100.
  // Weave them out of order in the array.
  const col2_L2 = createMockText("C2_L2", "Right Down", { left: 300, bottom: 155, right: 400, top: 175 });
  const col1_L1 = createMockText("C1_L1", "Left Up", { left: 10, bottom: 180, right: 100, top: 200 });
  const col2_L1 = createMockText("C2_L1", "Right Up", { left: 300, bottom: 180, right: 400, top: 200 });
  const col1_L2 = createMockText("C1_L2", "Left Down", { left: 10, bottom: 155, right: 100, top: 175 });
  const resCols = getReadingOrder([col2_L2, col1_L1, col2_L1, col1_L2]);
  
  // It should group into Region 1 (C1_L1, C1_L2) and Region 2 (C2_L1, C2_L2)
  // Region 1 is sorted before Region 2 because it's further left, despite having same Top Y.
  assertEqual("Reading Order: Basic 2-Column Unweaving", resCols.orderedObjectIds, ["C1_L1", "C1_L2", "C2_L1", "C2_L2"]);

  // 6. AMBIGUITY / ROTATION CONFIDENCE
  const resRot = getReadingOrder([t1, t2_rotated]);
  assertEqual("Confidence: Drops to 'medium' when rotated text is present", resRot.confidence, "medium");

  // 7. DETERMINISM (Input order does not matter)
  const orderA = getReadingOrder([col1_L1, col1_L2, col2_L1, col2_L2]);
  const orderB = getReadingOrder([col2_L2, col2_L1, col1_L2, col1_L1]);
  assertEqual("Determinism: Output remains identical regardless of input array order", orderA.orderedObjectIds, orderB.orderedObjectIds);

  console.log(`\nTests Completed: ${passed}/${total} Passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
