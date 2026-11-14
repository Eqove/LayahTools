# Sidebar Tool Audit — LayahTools Alpha (Phase 1)

> **Audited by:** Alpha Lane  
> **Date:** November 2026  
> **Architecture Principle:** "One Execution Engine. Multiple Interfaces."  
> **Status Classifications:**
> - `Working`: Implemented and verified by automated or manual tests.
> - `Partially Working`: Functional for standard cases, but has known scope limits or requires disclaimers.
> - `Pending`: Not yet implemented / requires external infrastructure; marked "Coming soon".
> - `Broken`: Exists in code but crashes or fails during execution.

---

## 1. Summary of All Registered Tools

| # | Tool ID | Display Name | Category | Processing Engine | Status | Primary Source Files |
|---|---|---|---|---|---|---|
| 1 | `pdf.merge` | Merge PDF | organize | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts`, `scripts/test-merge-order.ts` |
| 2 | `pdf.split` | Split PDF | organize | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts`, `src/lib/pdf/ranges.ts` |
| 3 | `pdf.extract` | Extract Pages | organize | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts`, `src/lib/pdf/ranges.ts` |
| 4 | `pdf.delete` | Delete Pages | organize | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts`, `src/lib/pdf/ranges.ts` |
| 5 | `pdf.rotate` | Rotate PDF | organize | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts` |
| 6 | `pdf.rearrange` | Rearrange Pages | organize | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts`, `components/pdf/viewer/PdfViewer.tsx` |
| 7 | `pdf.compress` | Compress PDF | organize | `pdf-lib` | **Partially Working** | `src/lib/pdf/heavy-operations.ts` |
| 8 | `pdf.edit` | Edit PDF | organize | `@embedpdf/pdfium` | **Working** | `src/lib/pdf/editor/session.ts`, `engine.ts`, `EditorController.tsx` |
| 9 | `pdf.blank` | Create Blank PDF | create | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts` |
| 10 | `pdf.sign` | Sign PDF | create | `pdf-lib` | **Partially Working** | `src/lib/pdf/operations.ts`, `components/pdf/interactive/SignOverlay.tsx` |
| 11 | `pdf.watermark` | Add Watermark | secure | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts` |
| 12 | `pdf.redact` | Redact PDF | secure | `pdf-lib` | **Partially Working** | `src/lib/pdf/operations.ts`, `components/pdf/interactive/RedactOverlay.tsx` |
| 13 | `pdf.page-numbers` | Page Numbers | organize | `pdf-lib` | **Working** | `src/lib/pdf/operations.ts` |
| 14 | `pdf.ocr` | OCR PDF | understand | `tesseract.js` | **Working** | `src/lib/pdf/heavy-operations.ts` |
| 15 | `pdf.pdf-to-image` | PDF to JPG/PNG | convert | `pdfjs-dist` (canvas) | **Working** | `src/lib/pdf/intelligence-operations.ts` |
| 16 | `pdf.extract-text` | Extract Text | understand | `pdfjs-dist` | **Working** | `src/lib/pdf/intelligence-operations.ts` |
| 17 | `pdf.analyze-structure` | Analyze Structure | understand | `pdfjs-dist` heuristics | **Working** | `src/lib/pdf/intelligence-operations.ts` |
| 18 | `pdf.extract-tables` | Extract Tables | understand | `pdfjs-dist` heuristics | **Working** | `src/lib/pdf/intelligence-operations.ts` |
| 19 | `pdf.pdf-to-word` | PDF to Word | convert | cloud backend | **Pending** ("Coming Soon") | `src/lib/pdf/cloud-operations.ts` |
| 20 | `pdf.pdf-to-excel` | PDF to Excel | convert | cloud backend | **Pending** ("Coming Soon") | `src/lib/pdf/cloud-operations.ts` |

---

## 2. In-Depth Tool Audits

### Tool 1: Merge PDF (`pdf.merge`)
- **Status:** **Working**
- **Engine:** `pdf-lib` (client-side).
- **Testing:** Tested with 3 independent PDF fixtures, reordered sequences, and corruption rejection (`scripts/test-merge-order.ts`).
- **Known Limitations:** Does not synthesize a unified table of contents. Form field name collisions are flattened by `pdf-lib`.

### Tool 2: Split PDF (`pdf.split`)
- **Status:** **Working**
- **Engine:** `pdf-lib`. Parses comma-separated ranges (e.g. `1-2, 3-5`).
- **Testing:** Tested range parsing and document export.
- **Known Limitations:** Invalid ranges beyond page count produce sanitized empty or truncated slices.

### Tool 3: Extract Pages (`pdf.extract`)
- **Status:** **Working**
- **Engine:** `pdf-lib`. Copies designated pages into a new PDF.

### Tool 4: Delete Pages (`pdf.delete`)
- **Status:** **Working**
- **Engine:** `pdf-lib`. Inverts the selection range to keep remaining pages.
- **Verification:** Reopening exported PDF shows reduced page count.

### Tool 5: Rotate PDF (`pdf.rotate`)
- **Status:** **Working**
- **Engine:** `pdf-lib`. Modifies `page.setRotation(degrees(angle))`.
- **Supported Angles:** 90°, 180°, 270°.

### Tool 6: Rearrange Pages (`pdf.rearrange`)
- **Status:** **Working**
- **Engine:** `pdf-lib` + `PdfViewer` grid thumbnail mode. Drag-and-drop page order updates `form.pageOrder`.

### Tool 7: Compress PDF (`pdf.compress`)
- **Status:** **Partially Working**
- **Engine:** `pdf-lib` object stream compression.
- **Testing:** Reduces uncompressed metadata streams.
- **Known Limitations:** Client-side `pdf-lib` cannot downsample high-resolution DCTDecode (JPEG) image streams without decompression and canvas re-encoding. A prominent user notice explains that V1 performs structural compression.

### Tool 8: Edit PDF (`pdf.edit`)
- **Status:** **Working** (Strictly Protected Beta Module)
- **Engine:** `@embedpdf/pdfium` WASM.
- **Testing:** 98/98 unit checks pass across multi-column, single line, and complex slide PDFs (`test-editor-session.ts`).
- **Capabilities:** Text replacement, font fallback to Helvetica for unmapped glyphs, image insertion, element deletion, rectangle addition, and undo/redo history.

### Tool 9: Create Blank PDF (`pdf.blank`)
- **Status:** **Working**
- **Engine:** `pdf-lib`. Generates standard letter/A4 pages with title and body text.

### Tool 10: Sign PDF (`pdf.sign`)
- **Status:** **Partially Working**
- **Engine:** `pdf-lib` + `SignOverlay.tsx`.
- **Behavior:** Loads user signature image (PNG/JPEG) and composites it onto chosen coordinates.
- **Known Limitations:** Visual stamp signature only. Does not generate cryptographic X.509 PKI digital certificate signatures (Rule 5 compliance: UI clearly denotes "Signature Image").

### Tool 11: Add Watermark (`pdf.watermark`)
- **Status:** **Working**
- **Engine:** `pdf-lib`. Draws 45-degree diagonal semi-transparent Helvetica text across all pages.

### Tool 12: Redact PDF (`pdf.redact`)
- **Status:** **Partially Working**
- **Engine:** `pdf-lib` + `RedactOverlay.tsx`.
- **Behavior:** User draws rectangle coordinates; `pdf-lib` draws filled black rectangles over those areas.
- **Security Notice (Rule 5):** "Visual cover is not secure redaction." Underlying PDF stream text tokens are not sanitized by pure rectangle overlays. A prominent security disclaimer was added in Alpha Phase 1.

### Tool 13: Page Numbers (`pdf.page-numbers`)
- **Status:** **Working**
- **Engine:** `pdf-lib`. Adds footer text ("Page X of Y") at the bottom-center of each page.

### Tool 14: OCR PDF (`pdf.ocr`)
- **Status:** **Working**
- **Engine:** `tesseract.js` WASM. Runs in browser worker.
- **Known Limitations:** CPU intensive; large scans (>10 pages) require substantial memory.

### Tool 15: PDF to JPG/PNG (`pdf.pdf-to-image`)
- **Status:** **Working**
- **Engine:** `pdfjs-dist` canvas rendering. Exports zipped or downloaded page images at 2.0x scale.

### Tool 16: Extract Text (`pdf.extract-text`)
- **Status:** **Working**
- **Engine:** `pdfjs-dist`. Outputs formatted JSON with coordinates and page associations.

### Tool 17: Analyze Structure (`pdf.analyze-structure`)
- **Status:** **Working**
- **Engine:** `pdfjs-dist` heuristics. Detects document hierarchy, headings, and paragraphs.

### Tool 18: Extract Tables (`pdf.extract-tables`)
- **Status:** **Working**
- **Engine:** Heuristic bounding box analysis. Outputs tabular JSON.

### Tool 19 & 20: PDF to Word (`pdf.pdf-to-word`) & PDF to Excel (`pdf.pdf-to-excel`)
- **Status:** **Pending** ("Coming Soon")
- **Root Cause:** True format reconstruction (PDF -> DOCX / XLSX) cannot run client-only without a heavy conversion engine (e.g. Adobe PDF Services, LibreOffice server, or cloud lambda).
- **Fix in Phase 1:** "Run Tool" button is cleanly disabled with "Coming Soon" badge and tooltip; simulated fake 800ms delays were removed.

---

## 3. Format Navigation Audit
- `Word`, `Excel`, `PowerPoint`, `Images`: Displayed with "soon" badge in `FormatSwitcher.tsx`.
- Empty workspace state gracefully displays `"Coming Soon"` for non-PDF format tabs without throwing errors or breaking navigation.
