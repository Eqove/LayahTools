# Alpha Phase 4 Report: Fidelity Support

Branch `alpha-phase4` (from `alpha-phase3`). Plan: `ALPHA_P4_IMPLEMENTATION_PLAN.md`. Full matrix: `ANNOTATION_PRESERVATION_MATRIX.md`.

Status labels used below: **Implemented** (code exists), **Tested** (an automated check in this repo exercises it and passed in the run recorded in section 8), **Partial** (works with a measured limitation), **Unverified** (not exercised in this pass).

## 1. Executive Summary
Phase 4's four tasks are implemented and covered by automated tests, and the production build succeeds. This close-out added the
missing part of A-4.4: an operations-by-annotation-type matrix over 15 annotation kinds and 23 operations (345 cells), measured by
running the real operations.

Result: **214 PASS, 131 PARTIAL, 0 FAIL.** No operation loses an annotation or changes its type, position, contents, colour,
border, opacity, author, date or appearance. Every non-PASS cell comes from two causes:
1. The 8 operations that rebuild a file through pdf-lib `copyPages` (merge, insert, split, extract x2, rearrange, compress, unlock)
   leave every annotation's `/P` pointing at an orphan page object, break internal (GoTo) link targets, and detach form widgets
   from the AcroForm. The annotations are still present and still render.
2. Redaction only draws a box. Annotations underneath keep their contents and appearance. (This is the existing "visual cover is
   not secure redaction" rule, now measured for annotations.)

Both are recorded and **deferred**, not fixed (section 10). No production behaviour was changed to make a test pass.

Not verified in this pass: the Fill Form and Flatten panels in a real browser, and human checks of flattened output in Chrome/Edge.

## 2. Phase 4 Objectives
Trustworthy output: a regression report that separates affected from unaffected pages, AcroForm filling, form flattening, and
annotation-preservation checks. Every export is reopened and verified, and the original is never replaced.

## 3. A-4.1 Regression Harness (commit `2e71c98`): Implemented, Tested
- `scripts/lib/fidelity.ts`: `snapshotPdf`, `compareSnapshots`, `formatReport`, expectation helpers (`rotatedBy`, `addsObjects`,
  `visiblyChanged`). Per page: text characters (PDF.js), PDFium object counts, annotations, and a render.
- `scripts/lib/visual-diff.ts`: `VisualDiffEngine` moved out of `test-visual-diff.ts` (behaviour unchanged).
- Unaffected pages must be identical (text, objects, annotations, pixels within threshold); affected pages must show the intended
  change; `pageMap` handles delete/extract/rearrange. Naming affected pages without an expectation throws.
- Tests: `test-fidelity-harness.ts` (22 checks) with positive cases on real operations and negative cases that doctor the output
  (stray rectangle, dropped page, reordered pages, lost annotation) and require a specific FAIL. `test-regression.ts` gained a section.

## 4. A-4.2 Form Filling (commit `3e47b61`): Implemented, Tested (UI Unverified)
- `src/lib/pdf/forms.ts`: `readFormFields`, `validateFormValues`, `fillForm` (validate, write, save, reopen, read every field back;
  any mismatch throws `VERIFY_FAILED`). Unsupported types (button, signature, unknown) are listed with a reason, never dropped.
- UI: `useFormFill.ts`, `FormFillPanel.tsx`, capability `pdf.fill-form`. Output goes to `results`; the source is untouched.
- Fixture `form-all-fields.pdf` (text, multiline, max length, checkbox, radio, dropdown, option list, read-only, button, signature).
- Tests: `test-forms.ts` (67 checks), including an independent PDF.js read-back and original-bytes-unchanged checks.
- Limitation: unlocking an encrypted file copies pages and drops the AcroForm (see 10).

## 5. A-4.3 Flattening (commit `a402fee`): Implemented, Tested (UI Unverified)
- `flattenForm` in `forms.ts`: inspects, regenerates missing appearances, calls pdf-lib `form.flatten`, **removes the dangling
  `/Annots` references pdf-lib leaves behind**, removes `/AcroForm`, saves, reopens, and verifies (no fields, no widgets, no dangling
  references, other annotations unchanged, counts by type unchanged). Failure throws `VERIFY_FAILED`.
- Non-widget annotations are kept, not flattened, and reported by type. Signed signatures produce a warning.
- UI: `useFlattenForm.ts`, `FlattenPanel.tsx` with pre-check summary and an "I understand" gate; capability `pdf.flatten`.
- Tests: `test-flatten.ts` (34 checks), including an independent PDFium render comparison and PDF.js cross-check.

## 6. A-4.4 Annotation Inspector (commit `4b63627`, extended in this close-out): Implemented, Tested
`src/lib/pdf/annotations.ts` (read-only, pdf-lib). `inspectAnnotations` throws on corrupt or encrypted input instead of returning a
false zero; `compareAnnotations` reports missing, added, modified (field-level) and removed-with-page, with a `pageMap`.

Added in this close-out (additive; A-4.1 and A-4.3 semantics unchanged):
- Compared fields: `author` (/T), `opacity` (/CA), `borderWidth` (/BS /W or /Border), `modified` (/M).
- Report-only fields: `appearanceDigest` (hash of the **decoded** /AP /N content, so a re-encode is not a change), `pageRefOk`
  (/P matches the containing page), `destPage` (GoTo target page index, -1 if outside the document), `inAcroForm` (widget reachable
  from /AcroForm /Fields).
- Fixture `annotations-matrix.pdf` (3 pages: Squiggly, Circle, Line, Stamp, Text with flags, FreeText, GoTo link to page 3, a widget,
  a Square on page 3; author/opacity/border/date set), manifest entry PDF-13. Existing fixtures regenerated byte-identically.
- Documented inspector limits: rich text (/RC), popup geometry, replies (/IRT), named destinations, actions other than URI/GoTo,
  appearance content is hashed not interpreted.

## 7. Annotation Preservation Matrix: Implemented, Tested
`scripts/test-annotation-matrix.ts` runs each operation on both annotation fixtures and classifies every source annotation:
PASS = present, all compared properties equal, structure intact (or removed on purpose); PARTIAL = present but degraded; FAIL = lost
or a property changed. The 131 non-PASS cells are pinned in `KNOWN`; any new non-PASS cell, or a pinned cell that changes, fails the
test. Annotation types covered (15): Highlight, Underline, StrikeOut, Squiggly, Text, Popup, Ink, FreeText, Square, Circle, Line,
Stamp, Link (URI), Link (GoTo), Widget.

| Operation | Result for all 15 types | Detail |
|---|---|---|
| load + save (pdf-lib) | PASS | dictionaries unchanged |
| watermark, page numbers, sign, OCR text overlay | PASS | in-place; annotations untouched |
| rotate (all / single page) | PASS | annotation dictionaries unchanged (page `/Rotate` changes) |
| crop (20 pt margins) | PASS | dictionaries unchanged (not checked against the new page box) |
| delete page (multi / single) | PASS | page's annotations removed with it; others kept |
| fill form | PASS | widget value changes as intended; markup unchanged |
| flatten form | PASS | widgets removed on purpose; all 10+ markup annotations unchanged |
| editor edit (PDFium export) | PASS | after add-rectangle and export, all annotations equal (decoded appearance) |
| merge, insert (merge with a blank page), split, extract all, extract single page, rearrange, compress, unlock | **PARTIAL x 15 types** | `/P` points at an orphan page; GoTo target dead; widgets detached from AcroForm |
| extract page 2 only | PARTIAL for 2 types | same cause, only the types present on page 2 (Highlight, Widget) |
| redact (box over top of page 1) | PARTIAL for 9 types | annotation under the box keeps contents and appearance |
| annotation editing | NOT APPLICABLE | LayahTools has no create/edit/delete-annotation operation |
| pdf-to-image, extract text/structure/tables, word, excel, metadata | NOT APPLICABLE | produce no PDF |

NOT SUPPORTED: none measured. The full 345-row table (`Type | Operation | Expected | Actual | Result`) is in
`ANNOTATION_PRESERVATION_MATRIX.md`.

## 8. Automated Test Results (run recorded for this close-out)
Each script run individually with `npx tsx`; every exit code 0.

| Script | Checks passed | Failed |
|---|---|---|
| test-workspace-files | 26 | 0 |
| test-merge-order | 15 | 0 |
| test-editor-session | 83 | 0 |
| test-no-mutation | 62 | 0 |
| test-session-contract | 99 | 0 |
| test-regression (A-1.7 + A-4.1 section) | 53 | 0 |
| test-visual-diff | 5 | 0 |
| test-phase2-capabilities | 21 | 0 |
| test-repeated-elements | 64 | 0 |
| test-lists | 85 | 0 |
| test-expected-outputs | 28 | 0 |
| test-text-layer | 144 | 0 |
| test-annotations (A-4.4 inspector, 10 new checks) | 50 | 0 |
| test-fidelity-harness (A-4.1) | 22 | 0 |
| test-forms (A-4.2) | 67 | 0 |
| test-flatten (A-4.3) | 34 | 0 |
| test-annotation-matrix (A-4.4 matrix) | 477 (only the final total is printed) | 0 |
| **Total** | **858 + 477 = 1335** | **0** |

I ran the 17 scripts of the `npm test` chain individually and tallied `PASS` lines. I did not run the single `npm test` command end to
end. The matrix script was added to that chain in `package.json`. The matrix total counts every one of its 345 cells plus pinned-entry checks.
Other diagnostics in `scripts/` that are not in `npm test` (for example `test-document-model`, `test-pdfium-engine`) were not run.

## 9. Production Build Results
`npm run build` (Next.js 16.2.3, Turbopack): compiled successfully, TypeScript finished, 4 static pages generated, no errors.
ESLint on the four files touched in this close-out (`annotations.ts`, `test-annotation-matrix.ts`, `test-annotations.ts`,
`generate-fidelity-fixtures.ts`): no findings. The repo-wide lint backlog was not touched.

## 10. Bugs Discovered and Fixed
**Fixed in this close-out (test tooling, not production behaviour):**
- First matrix run reported 11 FAIL cells for the editor edit. Cause: the appearance digest hashed raw stream bytes and PDFium
  re-encodes streams on export. The content was identical. Fixed by hashing the decoded content. The test now reports 0 FAIL.

**Discovered, root cause measured, deferred (production code unchanged):**
1. **`copyPages` orphans pages and breaks internal links.** pdf-lib `copyPages` also copies each source page as an extra `/Page`
   object outside the page tree (confirmed: 3 source pages give 6 `/Page` objects, 3 in the tree). Every copied annotation's `/P`
   and every GoTo `Dest` points at the orphan. Impact: internal links in output files go nowhere (PDF.js and PDFium viewers were not
   exercised for this; the inspector reports the target outside the document); the file carries a duplicate of each page; markup
   still renders. Affects merge, insert, split, extract, rearrange, compress, unlock (call sites in `operations.ts`, `page-actions.ts`,
   `heavy-operations.ts`, `password.ts`). Not fixed in Phase 4 because it needs a shared post-copy step (rewrite `/P`, remap `Dest`
   through the page map, drop the orphans) at 8 call sites, with its own regression test. The matrix pins the current behaviour.
2. **`copyPages` drops `/AcroForm`.** Widgets survive as annotations but are no longer form fields. Already known for unlock (section
   4), now measured for all 8 operations. Fixing it means copying the field tree.
3. **Redaction leaves annotations underneath.** `redactPdf` draws a rectangle only. Same root cause as the existing rule that visual
   cover is not secure redaction; the matrix shows annotation contents survive too.

## 11. Known Limitations
- Annotation editing, annotation flattening, and rotated-page annotation behaviour are not supported/measured visually (dictionary
  equality only; the rotate cells prove the dictionaries are unchanged, not how a viewer draws them).
- Inspection reads dictionaries and hashes appearance content; rich text, popup geometry, replies, named destinations and
  non-URI/GoTo actions are not compared.
- Matrix covers two synthetic fixtures built with pdf-lib. Real-world files from other producers (Acrobat, macOS Preview) were not tested.
- Operations that take a file with several output parts were run on a single full-range part (split).
- Flattening does not flatten markup annotations; signed signature fields are invalidated by any re-save.
- Crop was only tested with equal 20 pt margins, which no fixture annotation touches; an annotation outside the new box was not tested.

## 12. Remaining Issues
- Fix items 1 and 2 of section 10 (shared post-`copyPages` repair) in a later phase; change the pinned `KNOWN` cells with it.
- Human browser pass for the Fill Form and Flatten panels, and opening flattened output in Chrome/Edge: Unverified here.
- FILES drag-and-drop reorder (A-1.1) remains open until a human tests it (existing project rule).
- External CDN dependencies unchanged (PDF.js worker on unpkg, Tesseract assets).

## 13. Git Commit Information
Branch `alpha-phase4`, based on `alpha-phase3` (`584dc11`). Phase 4 commits: `4b63627` (A-4.4 inspector + fixtures + plan),
`2e71c98` (A-4.1), `3e47b61` (A-4.2), `a402fee` (A-4.3). Close-out commit: the one that adds this file
(`feat(alpha): complete phase 4 annotation preservation`); its hash is in the final message, since a commit cannot contain its own hash.
Files in the close-out: `src/lib/pdf/annotations.ts`, `scripts/test-annotation-matrix.ts`, `scripts/test-annotations.ts`,
`scripts/generate-fidelity-fixtures.ts`, `tests/fixtures/pdf-corpus/{annotations-matrix.pdf,manifest.json}`, `package.json`,
`ANNOTATION_PRESERVATION_MATRIX.md`, `ALPHA_PHASE4_REPORT.md`, `DEVELOPMENT_LOG.md`.

## 14. Final Phase 4 Completion Status
| Item | Implemented | Tested | Notes |
|---|---|---|---|
| A-4.1 Regression harness | Yes | Yes (22 + regression section) | |
| A-4.2 Form filling | Yes | Yes (67) | UI not re-verified in a browser |
| A-4.3 Flattening | Yes | Yes (34) | UI not re-verified in a browser |
| A-4.4 Annotation inspector | Yes | Yes (50) | |
| A-4.4 Preservation matrix | Yes | Yes (477) | 214 PASS, 131 PARTIAL, 0 FAIL |
| A-4.5 Final report | Yes | n/a | this document |
| Production build | Yes | Passed | |

**Phase 4 code and tests are complete and verified by automated runs. Closed with open items:** the PARTIAL results in the matrix are
real, understood and deferred (section 10), and the browser pass for the two new panels was not done in this session.
