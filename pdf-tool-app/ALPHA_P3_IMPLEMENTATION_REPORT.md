# Alpha Phase 3 — Implementation Report

Branch `alpha-phase3`. Commits since `9a567b7`: `aa9bdbc` (A-3.1), `9ad2de7` (A-3.2), `8de9be5` (line-grouping fix),
`6cee0ad` (A-3.3), `af35a86` (A-3.4), plus the docs commit that adds this report.

## 1. Executive summary

All four tasks are implemented, tested and committed. Header/footer/page-number detection (A-3.1) and list detection
(A-3.2) are pure TypeScript modules in `src/lib/interpretation/`. Labeled expected outputs (A-3.3) exist for the
table-heavy, multi-column and form fixtures and are validated against the real PDFs. The scanned-PDF flow (A-3.4)
detects text-less pages, shows page-level status, recommends OCR, runs the **existing** `ocrPdf` on the chosen pages,
shows progress and per-page errors, and never replaces the original file.

No Beta-owned file was modified (checked against `git diff --name-status 9a567b7 HEAD`). `npm test` passes, `npm run
build` passes, and the flow was exercised by hand in a real browser. Things that are **not** verified are listed in
section 8; the main ones are OCR accuracy on a genuine scan and offline behaviour.

One thing worth knowing: while labeling the real two-column PDF I found that my first line-grouping implementation
produced stray one-character lines and mis-split headings on real data. It passed all synthetic tests. I rewrote it
(`8de9be5`) and added regression tests from the real page. Details in section 5.

## 2. Completed tasks

| Task | Status | Evidence |
|---|---|---|
| A-3.1 Header/footer/repeated-element detector | Done | `test-repeated-elements.ts`, 64 checks |
| A-3.2 List detection | Done | `test-lists.ts`, 85 checks |
| A-3.3 Labeled expected outputs | Done | 3 JSON fixtures, `test-expected-outputs.ts`, 28 checks (18 are deliberate-failure checks) |
| A-3.4 Scanned PDF flow | Done, with limits in section 8 | `test-text-layer.ts`, 138 checks, plus manual browser run |

Definition-of-done check:
- A-3.1 and A-3.2 pass their tests: yes.
- A-3.3 contains validated expected outputs: yes. Every measurable value is re-measured from the PDF by the validator.
- A-3.4 works with the existing OCR integration: yes. `ocrPdf` was extended, not duplicated.
- No Alpha/Beta ownership violation: yes.
- Existing tests pass, production build passes, documentation complete: yes.

## 3. Files created

Library (`src/`):
- `lib/interpretation/types.ts`: `TextItem`, `PageText`, bounds helpers. Imports `LayahObjectBounds` as a type only.
- `lib/interpretation/text-lines.ts`: `groupIntoLines`, shared by both detectors.
- `lib/interpretation/repeated-elements.ts`: `detectRepeatedElements` (HEADER / FOOTER / PAGE_NUMBER).
- `lib/interpretation/lists.ts`: `detectLists`, `detectListsInPages`.
- `lib/interpretation/text-layer.ts`: page classification, OCR status model, PDF.js adapter `analyzeTextLayer`.
- `lib/pdf/ocr-overlay.ts`: the pdf-lib half of OCR (`overlayOcrText`), recogniser injected.
- `components/workspace/useOcrFlow.ts`: hook that owns analysis state, OCR scope, per-page status and the run.
- `components/workspace/OcrFlowPanel.tsx`: the panel UI.

Tests and fixtures:
- `scripts/test-repeated-elements.ts`, `test-lists.ts`, `test-expected-outputs.ts`, `test-text-layer.ts`
- `scripts/lib/pdf-text-pages.ts` (PDFium text through the engine, read-only), `pdf-paths.ts` (vector paths and ruled
  tables through raw PDFium), `expected-schema.ts`, `pdfjs-node.ts`
- `tests/fixtures/pdf-corpus/expected/{table-heavy,multi-column,form-acroform}.expected.json`

Docs: `ALPHA_P3_IMPLEMENTATION_PLAN.md`, this report.

## 4. Files modified

- `src/lib/pdf/heavy-operations.ts`: `ocrPdf` now delegates the pdf-lib half to `ocr-overlay.ts`. Added an optional
  third argument `{ pages, onPageStatus }`. Default behaviour (all pages, same output name) is unchanged.
- `src/components/workspace/Workspace.tsx`: one hook call, the `ocr` case in `runTool`, the Run button's disabled
  state and tooltip, the panel in the Configuration section, and removal of the old static OCR text.
- `package.json`: three test scripts appended to `npm test`. No dependency or lockfile change.
- `LAYAH_ARCHITECTURE.md`: PDF.js worker CDN call sites 6 -> 7 (new `useOcrFlow.ts`), and the Tesseract note.

## 5. Architecture decisions

1. **Detectors take plain `{text, bounds}` items**, not Layah model objects or engine pointers. They work with PDFium
   output (tests) or PDF.js output (browser) and need no change to Beta code.
2. **Text decides the page status; images only refine it.** `scanned-image-only.pdf` is a 2x2 transparent PNG scaled to
   the page. PDF.js emits no image paint for it (the same image does paint in `simple-text.pdf`), so it renders as a
   blank page and image coverage reads 0. Classifying by images alone would have called it empty. So: no meaningful text
   -> `SCANNED_PAGE`; image coverage only separates `MIXED_CONTENT` from `TEXT_AVAILABLE` and sets a `blank` hint. An
   opaque full-page image (generated in the test) exercises the coverage path.
3. **`MIXED_CONTENT` means text on top of a full-page image** (coverage >= 0.8 and >= 50 letters/digits). It is ambiguous
   between an already-recognised scan and a partly scanned page, so OCR is offered as optional, not recommended.
4. **No extra `EMPTY_PAGE` status.** The brief's six statuses are used as given; a blank page is `SCANNED_PAGE` with
   `blank: true` and the UI says OCR may find nothing.
5. **`ocr-overlay.ts` split out of `heavy-operations.ts`** so everything except Tesseract and canvas rendering runs and
   is tested in Node. The recogniser is injected. This is the same engine, relocated, not a second one.
6. **Rotated pages are refused by OCR** with a clear per-page error, instead of writing text with the wrong axes. This
   matches the project's "rotated pages unsupported" rule.
7. **Per-word failure isolation:** a word the standard font cannot encode, or a malformed box, is skipped and counted,
   instead of losing the rest of the page (the old code dropped the whole page on the first bad word).
8. **The original is never replaced.** The OCR result goes through the normal Outputs list; `replaceFile` is not used.
   The overlay test hashes the source bytes before and after.
9. **`groupIntoLines` rewrite (`8de9be5`).** First version anchored rows on an item's centre. On the real two-column page
   that produced 1pt-tall `.` lines and split `2 R` + `elated Work`. It now links items that overlap vertically and sit
   within a horizontal gap (default `max(14, 1.5 x height)`, below the sample's ~18pt gutter), as connected components.
10. **Labels are measured, not typed.** Only roles, zones, reading order and which window holds which region are human
    judgement (documented under `provenance` and `uncertain` in each JSON). Bounds, table grids, cell text and form
    fields are re-measured by the validator; text-region bounds are PDFium glyph-tight bounds.

## 6. Test results

Run from `pdf-tool-app/`.

| Suite | Result |
|---|---|
| `npm test` (all suites chained, includes the existing regression runner `test-regression.ts`) | exit 0, no FAIL |
| `test-repeated-elements.ts` | 64 pass, 0 fail |
| `test-lists.ts` | 85 pass, 0 fail |
| `test-expected-outputs.ts` | 28 pass, 0 fail |
| `test-text-layer.ts` | 138 pass, 0 fail (the adapter also runs in a child process against react-pdf's bundled pdf.js 5.4.296, the version the browser uses, as well as the root 6.3.289) |

What the tests cover: malformed input, empty documents, multi-page documents (up to 40 synthetic pages, 25 real),
determinism (repeat runs, shuffled input), no mutation of input, and real corpus PDFs through PDFium and PDF.js. The
validator also rejects 18 deliberately wrong expectations. Mutation spot-checks (band ratio, number-increase rule,
transform math, rotation refusal) each made the suites fail, then were reverted.

Real-data findings the tests encode: `long-document.pdf` yields exactly one element (page numbers 1..25) and its
"Section n" titles are correctly not headers; `multi-column.pdf` has no header/footer, and page 2 has one real 4-item
bullet list that is found.

Manual browser check (Next dev server + Playwright, one session, not a human acceptance test):
- Mixed PDF: "1 of 3 page(s) have no text (page 2)"; chips Text / Scanned / Text + image; OCR on page 2 ran through
  `OCR_PROCESSING` to `OCR_COMPLETED`; `mixed-demo-ocr.pdf` appeared in Outputs while `mixed-demo.pdf` stayed in Files.
- Text-only PDF: "All 3 page(s) have a text layer, so OCR is not needed"; Run disabled with the reason as tooltip and text.
- Rotated PDF, "All pages": `OCR_COMPLETED`, `OCR_FAILED`, `OCR_FAILED`; red alert with a message per failed page;
  status line "OCR finished with errors"; the partial output kept.
- No console errors.

## 7. Build results

- `npm run build`: exit 0 (Next 16.2.3 Turbopack, TypeScript pass, 4 static pages). No build output is tracked.
- Lint, touched files only: new files clean. `Workspace.tsx` has the same 3 legacy errors as at `HEAD`;
  `heavy-operations.ts` went from 3 problems to 1 (the remaining `as any` on `page.render` was already there). The test
  scripts use `as any` on purpose to feed malformed input; the existing scripts do the same. Unrelated legacy lint
  (e.g. `scripts/lib/mutation-probe.ts`) was not touched.

## 8. Known limitations

Detectors:
- Header/footer needs at least 2 pages. A header must be identical text (case/space-insensitive) in the same place;
  similar-but-different text is deliberately not merged. A header combined with a page number in one text object is
  handled only for the "Page n [of m]" form. Page numbers that alternate left/right on odd/even pages are found only if
  each side reaches 50% of pages (odd page counts can miss).
- Lists: bracketed markers (`[1]` references) and `1.1` section numbers are not recognised. A wrapped line flush with the
  marker (not the text) ends the list. Lists are not stitched across columns or pages. `i.` is ambiguous (alpha vs
  roman) and is resolved from the neighbours; a lone `i.` leans roman.
- Line grouping assumes a column gutter wider than `max(14, 1.5 x height)`. A tighter gutter merges columns; pass
  `lineGap` to change it.
- Real PDFium text is fragmented (words split mid-word, soft hyphens extracted as U+0002). Joined text is approximate.

Scanned-PDF flow:
- Detection looks at text presence, not text quality: a garbled or wrongly-encoded text layer counts as text.
- Image coverage is approximate (plain/inline/mask image paints only, overlaps double count, images PDF.js declines to
  paint are invisible to it).
- OCR is English only, writes word-level invisible text with Helvetica, so words with non-Latin characters are skipped
  (counted, not hidden). Rotated pages are refused.
- **Not verified:** OCR accuracy on a genuine scan (the only OCR run in a browser was on a blank gray page, which
  correctly produced 0 words); behaviour offline; other browsers; a large scan; a human acceptance pass.
- No cancel button for a running OCR job. Analysis re-runs whenever the active file or tool changes.
- Tesseract assets and the PDF.js worker load from public CDNs (now 7 PDF.js call sites). No document bytes are sent.
- The corpus fixture `scanned-image-only.pdf` is a transparent placeholder, so it is not a useful accuracy test.

Labels:
- `multi-column.pdf` labels rely on human reading of renders for roles, order and continuations; the `uncertain` list in
  the JSON names six judgement calls. Regions are coarse: indent-only paragraphs share a region.
- Only three fixtures are labeled, as scoped. No `annotated`, `image-heavy`, `rotated` or `long` labels.

## 9. Beta dependencies

None required. Nothing here needed a change to `PdfEditorEngine`, `EditorSession`, the Layah model, the mapper,
`EditorController` or `PdfViewer`. The engine is used read-only in test helpers only.

Suggestions for Beta, not requests:
- Column detection for the Layah model (`geometry.ts` already clusters regions) would let the detectors take columns
  instead of relying on a gap threshold.
- If the AI/command layer later consumes these results, the intent schema will need a place for "OCR these pages" and
  "list/header detected here"; the output types in `lib/interpretation/` are plain JSON-safe data for that.

## 10. Deferred tasks

- Run OCR on a real scanned document and record accuracy, and test offline.
- Rotated-page OCR (needs the PDF.js viewport transform; Alpha-side work in `ocr-overlay.ts` / `ocrPdf`).
- Cancel for OCR; language selection; non-Latin output (embed a Unicode font).
- Bracketed citation lists and `1.1` hierarchical numbering; cross-page / cross-column list stitching.
- Labels for the remaining corpus fixtures; a real scanned fixture.
- Connect the detectors to the command/AI workflow once Beta defines the intent contract.
- Human acceptance test of the OCR panel in more than one browser.
