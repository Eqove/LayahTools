# Visual-Diff Testing Harness Documentation — LayahTools Alpha (Task A-1.8)

> **Owner:** Alpha Lane  
> **Status:** Active  
> **Location:** `scripts/test-visual-diff.ts`

---

## 1. Overview & Architecture

The Visual-Diff Testing Harness provides automated pixel-level verification of PDF fidelity across document transformations. It is designed to catch unintended rendering regressions, layout shifts, or clipping when operations are performed.

### Key Capabilities
- **WASM Rasterization:** Utilizes the local `@embedpdf/pdfium` WASM engine to render PDF pages directly to in-memory BGRA/RGBA pixel buffers without requiring a browser DOM or native canvas dependencies.
- **Pixel-Accurate Comparison:** Computes total differing pixels, percentage change, and channel delta (`maxChannelDiff`).
- **Region Masks:** Allows defining bounding boxes `[{ left, top, right, bottom }]` for expected changes (e.g., added watermarks, signatures, or redactions) while strictly asserting 0% change in the unaffected page regions.
- **Configurable Tolerances:** Supports anti-aliasing threshold tolerances (default `5` units on a 0–255 scale) to avoid false positives from sub-pixel font hinting differences across operating systems.

---

## 2. Metrics & Tolerances

| Metric | Description | Default Acceptance Threshold |
|---|---|---|
| `diffPercentage` | Ratio of differing pixels to total rendered pixels | Dependent on operation |
| `maxChannelDiff` | Maximum delta across R, G, B channels (0–255) | Evaluated per test |
| `affectedRegionDiff` | Count of changed pixels inside the masked region | Expected > 0 for mutations |
| `unaffectedRegionDiff` | Count of changed pixels outside the masked region | Strict threshold: `0` (or ≤ 0.05% for raster jitter) |
| `passed` | Evaluates whether unaffected regions remained completely intact | Boolean `true` |

---

## 3. How to Run Visual-Diff Tests

Run the test suite directly with `tsx`:

```bash
cd pdf-tool-app
npx tsx scripts/test-visual-diff.ts
```

### Output Report
The runner generates a machine-readable JSON report at:
`tests/visual-diff-output/visual-diff-report.json`

Example report structure:
```json
{
  "testDate": "2026-11-07T13:34:05.123Z",
  "document": "simple-text.pdf",
  "resolution": "300x400",
  "identityTest": {
    "differingPixels": 0,
    "passed": true
  },
  "modifiedTest": {
    "totalDifferingPixels": 2448,
    "percentage": 2.04
  },
  "maskedTest": {
    "affectedPixels": 2448,
    "unaffectedPixels": 0,
    "passed": true
  }
}
```

---

## 4. Usage in Custom Regression Tests

```typescript
import { VisualDiffEngine } from "../scripts/test-visual-diff";

const engine = new VisualDiffEngine();
await engine.initialize();

// Render before and after buffers
const before = await engine.renderPageToRgba(originalBytes, 0, 300, 400);
const after = await engine.renderPageToRgba(modifiedBytes, 0, 300, 400);

// Assert unaffected regions remain pristine
const diff = engine.compare(before, after, {
  threshold: 5,
  masks: [{ left: 50, top: 200, right: 150, bottom: 300 }],
});

if (!diff.passed) {
  throw new Error(`Visual regression outside expected mask: ${diff.unaffectedRegionDiff} px changed`);
}
```
