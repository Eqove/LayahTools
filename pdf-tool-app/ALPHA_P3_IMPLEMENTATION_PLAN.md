# Alpha Phase 3 — Interpretation Helpers: Inspection Report + Plan

## Context
Alpha P3 adds deterministic interpretation helpers (header/footer detector, list detector), labeled expected outputs for
the corpus, and a scanned-PDF detection + OCR recommendation flow. These feed the future AI workflow, which emits intents
and never edits bytes. `AGENTS.md` puts "Header/footer and list detectors" in the Alpha lane, so this work is in scope for
Alpha. Branch: `alpha-phase3` (clean, HEAD `9a567b7`).

## Step 1: Inspection findings (read-only)

**Reusable components**
| Need | Existing | Notes |
|---|---|---|
| Bounds type | `LayahObjectBounds` in `src/lib/document/types.ts` (bottom-left, points) | Import the type only. No edits to Beta files. |
| Text objects in Node | `PdfEditorEngine` + `PdfToLayahMapper`, used read-only in `scripts/test-document-model.ts` | Gives `LayahTextObject{text,pageIndex,bounds,fontSize}` from real PDFs. Called, never modified. |
| Line grouping | `inferTextLines` (`lines.ts`) + reading order (`geometry.ts`) | Returns ids/bounds but no text. A small y-band grouping inside the detector is simpler than chaining three Beta functions. Decided at implementation time. |
| Browser text extraction | `extractPdfText` in `src/lib/pdf/intelligence-operations.ts` (PDF.js `getTextContent`) | Load pattern to copy for per-page text detection. |
| OCR | `ocrPdf` in `src/lib/pdf/heavy-operations.ts` (Tesseract.js, PDF.js render, pdf-lib invisible text) | **Reuse this.** Gaps: it OCRs every page, reports progress only as strings, and a failed page only logs `console.warn`. Wired into `Workspace.tsx` as tool `ocr`. Output is a new file and the original is kept. |
| Test harness | `scripts/test-*.ts` run by `tsx` with a `check(name, ok)` helper, chained in `npm test` | No framework. Follow the same pattern. |
| Corpus | `tests/fixtures/pdf-corpus/` + `manifest.json` (10 fixtures, sha256), built by `scripts/generate-corpus.ts` | Relevant: `table-heavy.pdf` (1 page, 4×5 drawn grid), `multi-column.pdf` (a copy of the real `double coloumn sample.pdf`, 3 pages), `form-acroform.pdf` (2 text fields), `scanned-image-only.pdf` (1 page, 2×2 PNG stretched, no text), `long-document.pdf` (25 pages, "Section i" heading plus a "Page i of 25" footer at y=40, useful for A-3.1). |

**Missing:** no header/footer detector, no list detector, no labeled expected outputs, no per-page text-layer detection,
and no mixed text/scanned fixture.

**Observations to note (not fixing):** the existing `extractTables` and `analyzeDocumentStructure` heuristics are
low-quality, and `test-regression.ts` requires at least 10 fixtures. Neither blocks this work.

## Step 2: Plan

### Files to create (all Alpha)
- `src/lib/interpretation/repeated-elements.ts`: `detectRepeatedElements(pages: {pageIndex,width,height,items:{text,bounds}[]}[], opts?)`
  returns `{text, kind:"HEADER"|"FOOTER"|"PAGE_NUMBER", pages:number[], pageNumbers?:number[], bounds, confidence}[]`.
  How it works:
  - Group items into lines with a y-band.
  - Look only at the top/bottom bands (about 10% of page height).
  - Normalize text (lowercase, collapse whitespace, digits replaced by `#`).
  - Cluster lines on matching normalized text plus position within a tolerance.
  - Treat a cluster as repeated if it appears on at least 50% of pages (at least 2).
  - Detect page numbers with regexes (`n`, `Page n`, `n of m`, `- n -`, roman numerals) whose number rises with the page index.
  - Group per section, so a header that changes between page runs is kept as separate elements.
  - Ignore body text: text repeated in the middle band is never classified.
  - Confidence = fraction of pages covered × positional consistency.
- `src/lib/interpretation/lists.ts`: `detectLists(lines, opts?)` returns `{type:"bullet"|"numbered"|"alpha"|"roman", items:{text,marker,order,level,bounds}[], bounds, confidence}[]`.
  How it works:
  - Recognize markers with regexes: `•◦▪‣-*–`, `1.`, `1)`, `(1)`, `a.`, `A)`, `i.`, `IV.`.
  - Resolve `i`/`v`/`x` as roman vs alpha from the neighbouring items.
  - Nesting level comes from clustering the left indent.
  - A wrapped line with no marker that is indented to the item's text start joins the previous item.
  - A gap larger than a threshold, or a non-list line at the base indent, ends the list.
  - A missing number in a sequence lowers confidence but doesn't split the list.
  - A lone marker line (a single item) is not a list. This handles paragraph false positives such as "1. In 2020...".
  - Input is the same simple `{text,bounds}` lines, so it works with PDFium or PDF.js output.
- `src/lib/interpretation/text-layer.ts`:
  - Pure `classifyPages(pages:{pageIndex,charCount,imageAreaRatio}[])` returns a per-page `TEXT_AVAILABLE | SCANNED_PAGE | MIXED_CONTENT`, plus `needsOcr`.
  - Browser adapter `analyzeTextLayer(file)`: PDF.js `getTextContent` counts characters, and `getOperatorList` image-paint ops with their CTM give image coverage.
  - Status reducer for `OCR_PROCESSING / OCR_COMPLETED / OCR_FAILED`.
- `scripts/test-repeated-elements.ts`, `scripts/test-lists.ts`, `scripts/test-text-layer.ts`: synthetic cases covering every
  case listed in the brief, malformed input (NaN bounds, empty strings, missing pages), empty documents, multi-page
  documents, a determinism check (run twice and deep-equal), and real-corpus cases through PDFium + mapper
  (`long-document.pdf` footer, `multi-column.pdf`).
- `tests/fixtures/pdf-corpus/expected/{table-heavy,multi-column,form-acroform}.expected.json`, all with one schema:
  `{fixture, sha256, source:"generator"|"manual-inspection", pages:[{pageIndex, textRegions:[{text,bounds,tolerance}],
  readingOrder:[...], tables:[{bounds,rows,cols}], formFields:[{name,type,bounds}]}], uncertain:[...], limitations:[...]}`.
  - Values for `table-heavy` and `form-acroform` come from `generate-corpus.ts` coordinates, then are checked against PDFium extraction and pdf-lib `getForm()`.
  - `multi-column` is a real document. Its values come from the actual extraction and are inspected by eye. Anything ambiguous goes under `uncertain`, not into expected values.
- `scripts/test-expected-outputs.ts` checks every expected JSON against the real PDFs: sha256 matches, text regions exist within tolerance, form fields match, and table rows/cols match the drawn grid lines.
- `ALPHA_P3_IMPLEMENTATION_PLAN.md` (this plan) and `ALPHA_P3_IMPLEMENTATION_REPORT.md`, both in `pdf-tool-app/` (not gitignored).

### Files to modify (Alpha only)
- `src/lib/pdf/heavy-operations.ts`: extend `ocrPdf` with an optional `{ pages?: number[], onPageStatus?(page, status, error?) }`.
  Defaults keep current behaviour, so the OCR engine is not duplicated. Failed pages are reported through the callback
  instead of being swallowed. If every requested page fails, it throws a meaningful error.
- `src/components/workspace/Workspace.tsx`, OCR tool panel:
  - Run `analyzeTextLayer` on the active file and show a per-page status list.
  - Offer "OCR scanned pages" only when `needsOcr`.
  - Show progress and per-page OCR status, and an error message on failure.
  - The result goes into `results` as a new file. The active file is not replaced.
- `package.json`: add the new test scripts to `npm test` (scripts only, no dependency changes).

### Beta dependencies
None needed. Beta modules (`engine.ts`, `mapper.ts`, `lib/document/*`) are only imported read-only in tests.

### Test strategy
- TDD per detector: write the tests, watch them fail, implement, watch them pass.
- Mixed PDF: built in memory in the test with pdf-lib by copying `simple-text` page 1 and the `scanned-image-only`
  page. This avoids adding an 11th corpus fixture and changing the manifest.
- OCR itself cannot run in Node, because `ocrPdf` uses `document.createElement("canvas")`. It is verified in the
  browser with `npm run dev`, and the report will say so.

### Risks
- `scanned-image-only.pdf` is a 2×2 PNG, so OCR will recognize no text. The flow must report "completed, no text found" honestly. A realistic scanned fixture would be a follow-up.
- Header/footer thresholds will be tuned on synthetic data plus 2 real docs, which is a small sample. Options are exposed and the limits documented.
- PDF.js image-coverage detection via the operator list is approximate. It is documented as such.
- The real `multi-column.pdf` may contain lists or headers. Only verified findings are labeled.

## Steps 3–7 (after approval)
1. A-3.1: tests, then code, then `tsx`. Commit on `alpha-phase3`, staging files by name, with no attribution lines.
2. A-3.2: the same cycle.
3. A-3.3: write the expected JSON files and the validation script.
4. A-3.4: `text-layer.ts` with its tests, then the `ocrPdf` options and the Workspace UI, then a manual browser check.
5. Final verification: run the new tests, `npm test`, `npm run build`, `npx tsx scripts/test-regression.ts`, and lint on touched files only. Then write the report.

## Verification
- `npx tsx scripts/test-repeated-elements.ts`, `test-lists.ts`, `test-text-layer.ts`, `test-expected-outputs.ts`: all PASS.
- `npm test` passes, including the existing suites. `npm run build` succeeds.
- Browser (`npm run dev`):
  - Open `scanned-image-only.pdf`: SCANNED_PAGE and an OCR offer appear. Running it shows progress and then a completed/no-text result.
  - Open `simple-text.pdf`: TEXT_AVAILABLE and no OCR offer.
  - The original file stays in FILES and the output appears in results.
