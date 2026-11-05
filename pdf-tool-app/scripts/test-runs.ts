import { NormalizedTextGeometry } from "../src/lib/document/geometry";
import { LayahTextLine } from "../src/lib/document/lines";
import { inferTextRuns } from "../src/lib/document/runs";

function createGeom(
  id: string, text: string, x: number, y: number, w: number, h: number,
  fontSize?: number, fontWeight?: number, isItalic?: boolean
): NormalizedTextGeometry {
  return {
    id, pageIndex: 0, text,
    bounds: { left: x, bottom: y, right: x + w, top: y + h },
    width: w, height: h, centerX: x + w / 2, centerY: y + h / 2,
    rotationAngle: 0, fontSize, fontWeight, isItalic
  };
}

function runTests() {
  console.log("=== Testing Phase 2.7C.3.2: Text Run Inference ===\n");
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

  const baseLine: LayahTextLine = {
    id: "l1", pageIndex: 0, confidence: "high",
    bounds: { left: 0, bottom: 0, right: 100, top: 100 },
    sourceObjectIds: []
  };

  // 1. Fragmented text (merges into 1 run)
  const g1 = createGeom("o1", "H", 10, 100, 10, 10, 12, 400, false);
  const g2 = createGeom("o2", "ello", 20, 100, 30, 10, 12, 400, false);
  const l1 = { ...baseLine, sourceObjectIds: ["o1", "o2"] };
  const runs1 = inferTextRuns([l1], [g1, g2]);
  assertEqual("Fragmented text merges into 1 run", runs1.length, 1);
  assertEqual("Run 1 IDs", runs1[0].sourceObjectIds, ["o1", "o2"]);

  // 2. Mixed font sizes
  const g3 = createGeom("o3", "Big", 60, 100, 30, 15, 18, 400, false);
  const l2 = { ...baseLine, sourceObjectIds: ["o1", "o3"] };
  const runs2 = inferTextRuns([l2], [g1, g3]);
  assertEqual("Mixed font sizes split runs", runs2.length, 2);
  assertEqual("Run 2 size", runs2[1].fontSize, 18);

  // 3. Bold vs Normal
  const g4 = createGeom("o4", "Bold", 60, 100, 30, 10, 12, 700, false);
  const l3 = { ...baseLine, sourceObjectIds: ["o1", "o4"] };
  const runs3 = inferTextRuns([l3], [g1, g4]);
  assertEqual("Bold vs Normal splits runs", runs3.length, 2);
  assertEqual("Run 2 weight", runs3[1].fontWeight, 700);

  // 4. Superscript/Subscript (sudden Y jump)
  const g5 = createGeom("o5", "2", 20, 105, 10, 5, 8, 400, false); // shifted up, smaller font
  const l4 = { ...baseLine, sourceObjectIds: ["o1", "g5"] }; // "H^2"
  const runs4 = inferTextRuns([{...baseLine, sourceObjectIds: ["o1", "o5"]}], [g1, g5]);
  assertEqual("Superscript split runs", runs4.length, 2);

  // 5. Spacing jump
  const g6 = createGeom("o6", "Far", 100, 100, 30, 10, 12, 400, false); // gap is 100-20=80
  const l5 = { ...baseLine, sourceObjectIds: ["o1", "o6"] };
  const runs5 = inferTextRuns([l5], [g1, g6]);
  assertEqual("Large spacing splits runs", runs5.length, 2);

  // 6. Missing metadata gracefully falls back
  const gNoMeta1 = createGeom("nm1", "A", 10, 100, 10, 10);
  const gNoMeta2 = createGeom("nm2", "B", 20, 100, 10, 10);
  const l6 = { ...baseLine, sourceObjectIds: ["nm1", "nm2"] };
  const runs6 = inferTextRuns([l6], [gNoMeta1, gNoMeta2]);
  assertEqual("Missing metadata merges via bounds", runs6.length, 1);

  console.log(`\nTests Completed: ${passed}/${total} Passed.`);
  if (passed !== total) process.exit(1);
}

runTests();
