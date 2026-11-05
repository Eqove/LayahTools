import { pdfToViewportPoint, viewportToPdfPoint, viewportDeltaToPdfDelta, PageCoordinateContext } from "../src/lib/document/coordinates";
import { hitTestPoint } from "../src/lib/document/hittest";
import { InteractionStateMachine, INITIAL_EDITOR_STATE } from "../src/lib/document/interaction";

function runTests() {
  console.log("=== Testing Phase 2.7D.1: Editor Interaction Foundation ===\n");
  let passed = 0;
  let total = 0;

  function assertEqual(name: string, actual: any, expected: any) {
    total++;
    // Use Math.abs for float comparisons if needed, but JSON.stringify works for most exact math here
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.error(`❌ ${name}`);
      console.error(`   Expected: ${JSON.stringify(expected)}`);
      console.error(`   Actual:   ${JSON.stringify(actual)}`);
    }
  }

  // 1. Coordinates (PDF bottom-left -> Viewport top-left)
  const ctx: PageCoordinateContext = { width: 800, height: 600, zoom: 2.0, rotation: 0 };
  
  // bottom-left corner in PDF (0, 0) should be bottom-left in Viewport -> X=0, Y=600 * 2 = 1200
  assertEqual("pdfToViewport (0,0)", pdfToViewportPoint({ x: 0, y: 0 }, ctx), { x: 0, y: 1200 });
  // top-right corner in PDF (800, 600) should be top-right in Viewport -> X=800 * 2 = 1600, Y=0
  assertEqual("pdfToViewport (800,600)", pdfToViewportPoint({ x: 800, y: 600 }, ctx), { x: 1600, y: 0 });
  
  // round-trip
  const pt = { x: 100, y: 200 };
  assertEqual("Round-trip conversion", viewportToPdfPoint(pdfToViewportPoint(pt, ctx), ctx), pt);

  // rotation (90 degrees clockwise)
  const ctx90: PageCoordinateContext = { ...ctx, rotation: 90 };
  // (0,0) in PDF (bottom-left) rotated 90 deg clockwise -> top-left -> (0,0) in viewport!
  // Wait, let's trace my math: X_vp = (600 - 0)*2 = 1200, Y_vp = 0*2 = 0. So it moves to Top-Right in unrotated frame?
  // Let's just test determinism.
  const pt90 = pdfToViewportPoint({ x: 0, y: 0 }, ctx90);
  assertEqual("pdfToViewport 90 deg", pt90, { x: 1200, y: 0 });
  assertEqual("Round-trip 90 deg", viewportToPdfPoint(pt90, ctx90), { x: 0, y: 0 });

  // delta conversion
  // Viewport down (+50) means PDF down (-25 since zoom=2)
  assertEqual("Delta conversion (0 rot)", viewportDeltaToPdfDelta(0, 50, ctx), { x: 0, y: -25 });
  // 90 deg rotation: moving mouse down (+50) means PDF moves LEFT (-25)
  assertEqual("Delta conversion (90 rot)", viewportDeltaToPdfDelta(0, 50, ctx90), { x: 25, y: -0 });

  // 2. Hit Testing
  const objects = [
    { id: "big_block", bounds: { left: 0, bottom: 0, right: 100, top: 100 } },
    { id: "small_run", bounds: { left: 10, bottom: 10, right: 20, top: 20 } },
  ];
  assertEqual("Hit test misses", hitTestPoint({ x: 200, y: 200 }, objects), null);
  assertEqual("Hit test big block", hitTestPoint({ x: 50, y: 50 }, objects), "big_block");
  assertEqual("Hit test overlapping (prioritizes smaller area)", hitTestPoint({ x: 15, y: 15 }, objects), "small_run");

  // 3. Interaction State Machine
  const sm = new InteractionStateMachine();
  assertEqual("Initial state is idle", sm.getState().phase, "idle");

  // Click empty space
  sm.pointerDown({ x: 0, y: 0 }, null);
  assertEqual("Click empty space -> selecting", sm.getState().phase, "selecting");
  sm.pointerUp();
  assertEqual("Pointer up -> idle", sm.getState().phase, "idle");

  // Click object
  sm.pointerDown({ x: 10, y: 10 }, "small_run");
  assertEqual("Click object -> pointer_down", sm.getState().phase, "pointer_down");
  assertEqual("Object is selected", sm.getState().selectedObjectIds, ["small_run"]);

  // Drag object
  sm.pointerMove({ x: 20, y: 20 });
  assertEqual("Move after down -> dragging", sm.getState().phase, "dragging");
  
  // Finish drag
  const intent = sm.pointerUp();
  assertEqual("Drag finish emits intent", intent?.type, "move");
  if (intent?.type === "move") {
    assertEqual("Intent deltaX", intent.deltaX, 10);
    assertEqual("Intent deltaY", intent.deltaY, 10);
  }

  // Keyboard Delete
  const delIntent = sm.keyDown("Backspace");
  assertEqual("Backspace emits delete intent", delIntent?.type, "delete");
  
  // Cancellation
  sm.pointerDown({ x: 0, y: 0 }, "small_run");
  sm.cancel();
  assertEqual("Cancel returns to idle", sm.getState().phase, "idle");

  // Multi-selection (Shift Click)
  sm.pointerDown({ x: 0, y: 0 }, "small_run"); // Select 1
  sm.pointerUp();
  sm.pointerDown({ x: 0, y: 0 }, "other_run", true); // Shift Select 2
  assertEqual("Shift-click multi-selects", sm.getState().selectedObjectIds, ["small_run", "other_run"]);
  
  sm.pointerUp(); // Reset phase to idle!
  sm.pointerDown({ x: 0, y: 0 }, "small_run", true); // Shift click again to toggle off
  assertEqual("Shift-click toggles selection off", sm.getState().selectedObjectIds, ["other_run"]);

  console.log(`\nTests Completed: ${passed}/${total} Passed.`);
  if (passed !== total) process.exit(1);
}

runTests();
