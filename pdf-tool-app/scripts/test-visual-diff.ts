import * as fs from "fs";
import * as path from "path";
import { PDFDocument, rgb } from "pdf-lib";
import { VisualDiffEngine, type RegionMask } from "./lib/visual-diff";

// =========================================================================
// RUNNER TESTS (Task A-1.8)
// =========================================================================

async function runVisualDiffTests() {
  console.log("=== LAYAHTOOLS VISUAL-DIFF HARNESS (Task A-1.8) ===\n");

  let failed = 0;
  const check = (name: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed++;
  };

  const engine = new VisualDiffEngine();
  await engine.initialize();
  check("VisualDiffEngine initialized with WASM renderer", true);

  // 1. Identity Test: Comparing identical document against itself must yield 0% diff
  const corpusPdfPath = path.resolve(__dirname, "../tests/fixtures/pdf-corpus/simple-text.pdf");
  const baseBytes = fs.readFileSync(corpusPdfPath);

  const renderA = await engine.renderPageToRgba(baseBytes, 0, 300, 400);
  const renderB = await engine.renderPageToRgba(baseBytes, 0, 300, 400);

  const identityDiff = engine.compare(renderA, renderB);
  check(
    "Identity comparison yields 0 differing pixels",
    identityDiff.differingPixels === 0 && identityDiff.diffPercentage === 0,
    `diff = ${identityDiff.diffPercentage}%`
  );

  // 2. Modified Document Test: Draw a red box on the page
  const modifiedDoc = await PDFDocument.load(baseBytes);
  const page = modifiedDoc.getPage(0);
  // Draw a red box in the top-right quadrant
  // In PDF coords: origin is bottom-left (Y goes up). Box at x=150..250, y=250..350
  page.drawRectangle({
    x: 150,
    y: 250,
    width: 100,
    height: 100,
    color: rgb(1, 0, 0),
  });
  const modifiedBytes = await modifiedDoc.save();
  const renderModified = await engine.renderPageToRgba(modifiedBytes, 0, 300, 400);

  // Compare without masks: should detect difference
  const unmaskedDiff = engine.compare(renderA, renderModified);
  check(
    "Unmasked comparison accurately detects visual change",
    unmaskedDiff.differingPixels > 0 && unmaskedDiff.diffPercentage > 1,
    `diff = ${unmaskedDiff.diffPercentage}% (${unmaskedDiff.differingPixels} px)`
  );

  // 3. Region Mask Test: Mask out the modified rectangle
  // In screen/render coords: height = 400. Y is inverted from PDF coords.
  // PDF [150, 250, 250, 350] on 595x842 maps to rendered screen coords:
  // x: ~75..126, y (from top): ~233..282
  const masks: RegionMask[] = [
    {
      left: 65,
      top: 220,
      right: 135,
      bottom: 295,
    },
  ];

  const maskedDiff = engine.compare(renderA, renderModified, { masks });
  check(
    "Region mask isolates affected changes and passes unaffected area",
    maskedDiff.passed && maskedDiff.unaffectedRegionDiff === 0,
    `unaffected diff = ${maskedDiff.unaffectedRegionDiff} px, affected diff = ${maskedDiff.affectedRegionDiff} px`
  );

  // 4. Report generation
  const reportDir = path.resolve(__dirname, "../tests/visual-diff-output");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    testDate: new Date().toISOString(),
    document: "simple-text.pdf",
    resolution: "300x400",
    identityTest: {
      differingPixels: identityDiff.differingPixels,
      passed: identityDiff.passed,
    },
    modifiedTest: {
      totalDifferingPixels: unmaskedDiff.differingPixels,
      percentage: unmaskedDiff.diffPercentage,
    },
    maskedTest: {
      affectedPixels: maskedDiff.affectedRegionDiff,
      unaffectedPixels: maskedDiff.unaffectedRegionDiff,
      passed: maskedDiff.passed,
    },
  };

  const reportPath = path.join(reportDir, "visual-diff-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  check("Visual-diff test report generated successfully", fs.existsSync(reportPath), reportPath);

  console.log(`\n=================================================`);
  console.log(failed ? `${failed} VISUAL-DIFF TESTS FAILED` : "ALL VISUAL-DIFF TESTS PASSED");
  console.log(`=================================================\n`);

  process.exit(failed ? 1 : 0);
}

runVisualDiffTests().catch((e) => {
  console.error("Visual diff harness error:", e);
  process.exit(1);
});
