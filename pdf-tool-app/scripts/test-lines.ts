import { NormalizedTextGeometry, ReadingOrderResult } from "../src/lib/document/geometry";
import { inferTextLines } from "../src/lib/document/lines";

function createGeom(id: string, text: string, x: number, y: number, w: number, h: number, rot = 0): NormalizedTextGeometry {
  return {
    id,
    pageIndex: 0,
    text,
    bounds: { left: x, bottom: y, right: x + w, top: y + h },
    width: w,
    height: h,
    centerX: x + w / 2,
    centerY: y + h / 2,
    rotationAngle: rot,
  };
}

function runTests() {
  console.log("=== Testing Phase 2.7C.3.1: Text Line Inference ===\n");
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

  // 14. Empty input
  assertEqual("Empty input", inferTextLines([], { orderedObjectIds: [], confidence: "high", reasons: [] }).length, 0);

  // 1. Single text object (and 15. Single-object line)
  const g1 = createGeom("o1", "Hello", 10, 100, 40, 10);
  const ro1: ReadingOrderResult = { orderedObjectIds: ["o1"], confidence: "high", reasons: [] };
  const lines1 = inferTextLines([g1], ro1);
  assertEqual("Single object -> Single line", lines1.length, 1);
  assertEqual("Single object line ID", lines1[0].sourceObjectIds, ["o1"]);
  assertEqual("Single object bounds", lines1[0].bounds, { left: 10, bottom: 100, right: 50, top: 110 });

  // 2. Multiple objects on one line & 3. Fragmented objects
  const g2 = createGeom("o2", "World", 55, 100, 40, 10);
  const ro2: ReadingOrderResult = { orderedObjectIds: ["o1", "o2"], confidence: "high", reasons: [] };
  const lines2 = inferTextLines([g1, g2], ro2);
  assertEqual("Two objects, same line", lines2.length, 1);
  assertEqual("Two objects IDs", lines2[0].sourceObjectIds, ["o1", "o2"]);
  assertEqual("Merged bounds", lines2[0].bounds, { left: 10, bottom: 100, right: 95, top: 110 });

  // 4. Multiple lines
  const g3 = createGeom("o3", "NextLine", 10, 80, 50, 10);
  const ro3: ReadingOrderResult = { orderedObjectIds: ["o1", "o2", "o3"], confidence: "high", reasons: [] };
  const lines3 = inferTextLines([g1, g2, g3], ro3);
  assertEqual("Multiple lines", lines3.length, 2);
  assertEqual("Line 1 IDs", lines3[0].sourceObjectIds, ["o1", "o2"]);
  assertEqual("Line 2 IDs", lines3[1].sourceObjectIds, ["o3"]);

  // 5. Slight Y-coordinate jitter
  const gJitter = createGeom("o_jitter", "Jitter", 100, 102, 30, 10); // slightly higher Y
  const ro4: ReadingOrderResult = { orderedObjectIds: ["o1", "o2", "o_jitter"], confidence: "high", reasons: [] };
  const lines4 = inferTextLines([g1, g2, gJitter], ro4);
  assertEqual("Slight jitter merges cleanly", lines4.length, 1);
  assertEqual("Slight jitter IDs", lines4[0].sourceObjectIds, ["o1", "o2", "o_jitter"]);

  // 6. Different object heights & 9. Mixed font sizes
  const gTall = createGeom("o_tall", "Tall", 55, 100, 40, 20); // twice as tall
  const ro5: ReadingOrderResult = { orderedObjectIds: ["o1", "o_tall"], confidence: "high", reasons: [] };
  const lines5 = inferTextLines([g1, gTall], ro5);
  assertEqual("Mixed heights on same baseline", lines5.length, 1);

  // 7. Large vertical separation
  const gFarDown = createGeom("o_far", "Down", 10, 50, 40, 10);
  const ro6: ReadingOrderResult = { orderedObjectIds: ["o1", "o_far"], confidence: "high", reasons: [] };
  const lines6 = inferTextLines([g1, gFarDown], ro6);
  assertEqual("Large vertical separation -> two lines", lines6.length, 2);

  // 8. Large horizontal separation (triggers split)
  const gFarRight = createGeom("o_right", "Right", 300, 100, 40, 10); // gap is 250, max is 50 for height 10
  const ro7: ReadingOrderResult = { orderedObjectIds: ["o1", "o_right"], confidence: "high", reasons: [] };
  const lines7 = inferTextLines([g1, gFarRight], ro7, { maximumHorizontalGapMultiplier: 5 });
  assertEqual("Large horizontal separation -> two lines", lines7.length, 2);

  // 10. Rotated text
  const gRot1 = createGeom("r1", "Up", 10, 100, 10, 40, 90);
  const gRot2 = createGeom("r2", "Up2", 10, 145, 10, 40, 90);
  const ro8: ReadingOrderResult = { orderedObjectIds: ["r1", "r2"], confidence: "medium", reasons: [] };
  const lines8 = inferTextLines([gRot1, gRot2], ro8);
  assertEqual("Rotated text splits gracefully into 1-word lines (V1 limitation)", lines8.length, 2);
  assertEqual("Rotated text confidence degrades", lines8[0].confidence, "medium");

  // 11. Ambiguous vertical relationship (overlapping slightly but not enough)
  const gAmb = createGeom("amb", "Over", 10, 95, 40, 10); // overlaps by 5, which is 50%.
  // If we set minimumVerticalOverlapRatio to 0.8, they should split.
  const ro9: ReadingOrderResult = { orderedObjectIds: ["o1", "amb"], confidence: "high", reasons: [] };
  const lines9 = inferTextLines([g1, gAmb], ro9, { sameLineVerticalTolerance: 1, minimumVerticalOverlapRatio: 0.8 });
  assertEqual("Ambiguous overlap splits if tolerance tight", lines9.length, 2);

  // 12. Determinism & 13. Two-column ordering using C.2 output
  // Simulate C.2 reading order: L1, L2, R1, R2
  const cL1 = createGeom("L1", "L1", 10, 200, 40, 10);
  const cL2 = createGeom("L2", "L2", 10, 180, 40, 10);
  const cR1 = createGeom("R1", "R1", 100, 200, 40, 10);
  const cR2 = createGeom("R2", "R2", 100, 180, 40, 10);
  const roCol: ReadingOrderResult = { orderedObjectIds: ["L1", "L2", "R1", "R2"], confidence: "high", reasons: [] };
  const linesCol = inferTextLines([cL1, cL2, cR1, cR2], roCol);
  
  assertEqual("C.2 column ordering respected (4 lines total)", linesCol.length, 4);
  assertEqual("Col Line 1", linesCol[0].sourceObjectIds, ["L1"]);
  assertEqual("Col Line 2", linesCol[1].sourceObjectIds, ["L2"]);
  assertEqual("Col Line 3", linesCol[2].sourceObjectIds, ["R1"]);
  assertEqual("Col Line 4", linesCol[3].sourceObjectIds, ["R2"]);

  console.log(`\nTests Completed: ${passed}/${total} Passed.`);
  if (passed !== total) process.exit(1);
}

runTests();
