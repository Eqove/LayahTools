import * as fs from "fs";
import * as path from "path";
import { init } from "@embedpdf/pdfium";
import { PDFDocument, rgb } from "pdf-lib";

interface RegionMask {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface DiffResult {
  width: number;
  height: number;
  totalPixels: number;
  differingPixels: number;
  diffPercentage: number;
  maxChannelDiff: number;
  affectedRegionDiff: number;
  unaffectedRegionDiff: number;
  passed: boolean;
}

export class VisualDiffEngine {
  private pdfium: any = null;
  private wasm: any = null;

  async initialize() {
    if (this.pdfium) return;
    const wasmPath = path.resolve(__dirname, "../public/pdfium.wasm");
    const wasmBinary = fs.readFileSync(wasmPath);
    this.pdfium = await init({ wasmBinary });
    this.wasm = this.pdfium.pdfium || this.pdfium;
    this.pdfium.PDFiumExt_Init();
  }

  /**
   * Renders a specific page of a PDF buffer to a raw RGBA Pixel Buffer.
   */
  async renderPageToRgba(
    pdfBytes: Uint8Array,
    pageIndex: number = 0,
    width: number = 400,
    height: number = 600
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    await this.initialize();

    const ptr = this.wasm._malloc(pdfBytes.length);
    this.wasm.HEAPU8.set(pdfBytes, ptr);

    const doc = this.pdfium.FPDF_LoadMemDocument(ptr, pdfBytes.length, "");
    if (!doc) {
      this.wasm._free(ptr);
      throw new Error("Failed to load PDF in PDFium for rendering");
    }

    const page = this.pdfium.FPDF_LoadPage(doc, pageIndex);
    if (!page) {
      this.pdfium.FPDF_CloseDocument(doc);
      this.wasm._free(ptr);
      throw new Error(`Failed to load page index ${pageIndex}`);
    }

    // Create bitmap (0 = BGRx / BGRA)
    const bitmap = this.pdfium.FPDFBitmap_Create(width, height, 0);
    // Fill white (0xFFFFFFFF)
    this.pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    // Render page
    this.pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0);

    const bufPtr = this.pdfium.FPDFBitmap_GetBuffer(bitmap);
    const byteLength = width * height * 4;
    const rawBytes = new Uint8Array(this.wasm.HEAPU8.slice(bufPtr, bufPtr + byteLength));

    // Cleanup PDFium handles
    this.pdfium.FPDFBitmap_Destroy(bitmap);
    this.pdfium.FPDF_ClosePage(page);
    this.pdfium.FPDF_CloseDocument(doc);
    this.wasm._free(ptr);

    return { data: rawBytes, width, height };
  }

  /**
   * Compare two RGBA buffers with optional region masks.
   * Region coordinates are normalized or in pixel units: [left, top, right, bottom].
   */
  compare(
    imgA: { data: Uint8Array; width: number; height: number },
    imgB: { data: Uint8Array; width: number; height: number },
    options: {
      threshold?: number; // color difference threshold (0-255)
      maxAllowedUnaffectedDiffPercent?: number; // threshold for unaffected region
      masks?: RegionMask[];
    } = {}
  ): DiffResult {
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      throw new Error(`Dimension mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`);
    }

    const { width, height } = imgA;
    const totalPixels = width * height;
    const threshold = options.threshold ?? 5; // allow minor anti-aliasing jitter
    const maxAllowedUnaffected = options.maxAllowedUnaffectedDiffPercent ?? 0.05; // 0.05%
    const masks = options.masks ?? [];

    let differingPixels = 0;
    let maxChannelDiff = 0;
    let affectedRegionDiff = 0;
    let unaffectedRegionDiff = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const bA = imgA.data[idx];
        const gA = imgA.data[idx + 1];
        const rA = imgA.data[idx + 2];

        const bB = imgB.data[idx];
        const gB = imgB.data[idx + 1];
        const rB = imgB.data[idx + 2];

        const dR = Math.abs(rA - rB);
        const dG = Math.abs(gA - gB);
        const dB = Math.abs(bA - bB);
        const maxD = Math.max(dR, dG, dB);

        if (maxD > threshold) {
          differingPixels++;
          if (maxD > maxChannelDiff) maxChannelDiff = maxD;

          // Check if this pixel falls inside any masked region
          const inMask = masks.some(
            (m) => x >= m.left && x <= m.right && y >= m.top && y <= m.bottom
          );

          if (inMask) {
            affectedRegionDiff++;
          } else {
            unaffectedRegionDiff++;
          }
        }
      }
    }

    const diffPercentage = (differingPixels / totalPixels) * 100;
    const unaffectedDiffPercent = (unaffectedRegionDiff / totalPixels) * 100;

    // Test passes if unaffected region diff is within the allowed threshold
    const passed = unaffectedDiffPercent <= maxAllowedUnaffected;

    return {
      width,
      height,
      totalPixels,
      differingPixels,
      diffPercentage: Number(diffPercentage.toFixed(2)),
      maxChannelDiff,
      affectedRegionDiff,
      unaffectedRegionDiff,
      passed,
    };
  }
}

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
