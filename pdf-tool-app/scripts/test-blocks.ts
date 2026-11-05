import { LayahTextLine } from "../src/lib/document/lines";
import { inferTextBlocks } from "../src/lib/document/blocks";

function createLine(id: string, pageIndex: number, x: number, y: number, w: number, h: number, confidence: "high"|"medium"|"low" = "high"): LayahTextLine {
  return {
    id,
    pageIndex,
    sourceObjectIds: [id + "_obj"],
    bounds: { left: x, bottom: y, right: x + w, top: y + h },
    confidence,
  };
}

function runTests() {
  console.log("=== Testing Phase 2.7C.3.3: Text Block Inference ===\n");
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

  // 1. Empty input
  assertEqual("Empty input", inferTextBlocks([]).length, 0);

  // 2. Single line
  const l1 = createLine("l1", 0, 10, 100, 100, 10);
  const blocks1 = inferTextBlocks([l1]);
  assertEqual("Single line -> 1 block", blocks1.length, 1);
  assertEqual("Single line ID", blocks1[0].lineIds, ["l1"]);

  // 3. Multiple closely spaced lines forming one block
  const l2 = createLine("l2", 0, 10, 85, 100, 10); // gap = 100 - 95 = 5 (avg height 10, mult 2.0 = 20 max)
  const blocks2 = inferTextBlocks([l1, l2]);
  assertEqual("Closely spaced lines", blocks2.length, 1);
  assertEqual("Closely spaced lines IDs", blocks2[0].lineIds, ["l1", "l2"]);

  // 4. Large vertical gap creating separate blocks
  const l3 = createLine("l3", 0, 10, 50, 100, 10); // gap = 85 - 60 = 25 (> 20)
  const blocks3 = inferTextBlocks([l1, l2, l3]);
  assertEqual("Large vertical gap splits", blocks3.length, 2);
  assertEqual("Block 1 IDs", blocks3[0].lineIds, ["l1", "l2"]);
  assertEqual("Block 2 IDs", blocks3[1].lineIds, ["l3"]);

  // 5. Indentation-based separation & 6. Clearly separate horizontal regions
  const l_indent = createLine("ind1", 0, 100, 85, 100, 10); // shifted right by 90 (avg height 10 * 4 = 40 max)
  const blocks4 = inferTextBlocks([l1, l_indent]);
  assertEqual("Indentation/horizontal displacement splits", blocks4.length, 2);

  // 7. Mixed line heights
  const l_tall = createLine("tall", 0, 10, 80, 100, 20); // gap = 100 - 100 = 0.
  const blocks5 = inferTextBlocks([l1, l_tall]);
  assertEqual("Mixed line heights merge if close", blocks5.length, 1);

  // 8. Rotated lines (represented by confidence drop and bounds overlaps)
  // If lines heavily overlap vertically (vGap < -avgHeight), confidence drops.
  const l_overlap = createLine("overlap", 0, 10, 110, 100, 10); // top = 120, vGap = 100 - 120 = -20
  const blocks6 = inferTextBlocks([l1, l_overlap]);
  assertEqual("Heavy vertical overlap merges but lowers confidence", blocks6[0].confidence, "low");

  // 12. PageIndex consistency
  const l_page2 = createLine("p2", 1, 10, 85, 100, 10);
  const blocks7 = inferTextBlocks([l1, l_page2]);
  assertEqual("Different pages split blocks", blocks7.length, 2);

  // 13. Two-column layout (jump up)
  // C.2 ordering: Left1, Left2, Right1, Right2
  const cL1 = createLine("L1", 0, 10, 200, 40, 10);
  const cL2 = createLine("L2", 0, 10, 180, 40, 10);
  const cR1 = createLine("R1", 0, 100, 200, 40, 10); // centerY = 205 (L2 centerY = 185) -> jump up by 20!
  const cR2 = createLine("R2", 0, 100, 180, 40, 10);
  const blocks8 = inferTextBlocks([cL1, cL2, cR1, cR2]);
  assertEqual("Two-column jump UP splits blocks", blocks8.length, 2);
  assertEqual("Col 1 IDs", blocks8[0].lineIds, ["L1", "L2"]);
  assertEqual("Col 2 IDs", blocks8[1].lineIds, ["R1", "R2"]);

  // 11. Correct union bounds
  assertEqual("Union bounds check", blocks8[0].bounds, { left: 10, bottom: 180, right: 50, top: 210 });

  // 10. No duplicate line membership
  const allLines = blocks8.flatMap(b => b.lineIds);
  const uniqueLines = [...new Set(allLines)];
  assertEqual("No duplicate line membership", allLines.length, uniqueLines.length);

  // 9. Deterministic ordering
  const blocks9 = inferTextBlocks([cL1, cL2, cR1, cR2]);
  assertEqual("Deterministic ordering check", blocks8, blocks9);

  console.log(`\nTests Completed: ${passed}/${total} Passed.`);
  if (passed !== total) process.exit(1);
}

runTests();
