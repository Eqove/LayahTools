# Alpha Phase 4 — Fidelity Support: Inspection Report + Plan

## Context
Alpha P4 is about trustworthy output: a regression report that separates affected pages from unaffected ones, AcroForm
filling, form flattening, and annotation-preservation checks. Every export is reopened and verified, and the original
file is never replaced.

Work happens on a new branch `alpha-phase4`, created from `alpha-phase3` (HEAD `584dc11`, clean). This is so that P4
can reuse the P3 helpers `scripts/lib/pdfjs-node.ts` and `scripts/lib/pdf-paths.ts`.

The first action after approval is to copy this plan into `pdf-tool-app/ALPHA_P4_IMPLEMENTATION_PLAN.md`.

## Step 1: Inspection findings (read-only)

### Existing, reusable
| Need | Where | Notes |
|---|---|---|
| Regression runner (A-1.7) | `scripts/test-regression.ts` | Checks the manifest baseline and runs 7 pdf-lib ops with an export-reopen page-count check. It does no per-page or content comparison. |
| Visual diff (A-1.8) | `scripts/test-visual-diff.ts`, class `VisualDiffEngine` | PDFium render to RGBA plus a pixel compare with region masks. The class lives in a file that runs its own tests at import, so it can't be imported yet. Render flags are hard-coded to 0, so widget and annotation appearances are not drawn. |
| Corpus | `tests/fixtures/pdf-corpus/` + `manifest.json` (10 fixtures, sha256) | `form-acroform.pdf` has 2 text fields only, with no checkbox, radio, dropdown or option list. |
| PDF.js in Node | `scripts/lib/pdfjs-node.ts` (P3) | Supports `getTextContent`; `getAnnotations` is usable for an independent cross-check. |
| PDFium raw access | `scripts/lib/pdf-paths.ts` (P3) | Pattern for object counts via `FPDFPage_CountObjects` / `GetType`. The `FPDFAnnot_*` API is also exported by `@embedpdf/pdfium`. |
| pdf-lib ops | `src/lib/pdf/operations.ts` | merge, split, extract, delete, rotate, watermark, page numbers, blank, rearrange, redact, sign, crop. |
| Password | `src/lib/pdf/password.ts` | `isEncryptedPdf` and `unlockEncryptedPdf`. Unlocking copies pages into a new document, so the **AcroForm is dropped**. P4 will measure this and report it. |
| UI | `Workspace.tsx` (tool switch, `toolIdMap`), `capabilities/registry.ts`, `OcrFlowPanel`/`useOcrFlow` (P3 hook+panel pattern), `ui/ErrorState`, `ui/ProgressBar`, `PasswordDialog` | A new tool is added as a capability, a `PdfToolId`, a Workspace case and a panel. |

### Missing
- No form-filling code anywhere in `src`. The only use of `getForm()` is one regression check.
- No flattening code.
- No annotation code in `src`. The only annotation-related item is react-pdf's `renderAnnotationLayer` in `PdfViewer`, which is display only. **There is no Beta annotation controller in the repo**, so there is nothing to modify or avoid.
- No per-page fidelity comparison and no annotation inspector.

### Facts found by read-only probes
1. **`annotated.pdf` contains no annotations.** It has 0 `/Annots`; the "highlight" is a drawn rectangle. The manifest's `hasAnnotations: true` is wrong. No corpus fixture has a real annotation.
2. **pdf-lib 1.17.1 `form.flatten()` leaves dangling references.** On `form-acroform.pdf`, fields drop to 0, but page `/Annots` still holds `11 0 R` and `15 0 R`, which point to deleted objects. The flatten implementation must remove those references and verify that none remain.
3. **pdf-lib `copyPages` copies `/Annots`.** A highlight, a text note and an ink annotation all survived in a probe. Whether popups and their parent links survive, and what happens to widgets, has not been measured yet; A-4.4 will measure it.

## Step 2: Plan

### A-4.1 Regression harness extension (reuses A-1.7/A-1.8, no new runner)
- **Move `VisualDiffEngine`** into `scripts/lib/visual-diff.ts`.
  - `test-visual-diff.ts` imports it; its behaviour is unchanged.
  - Add an optional `flags` argument to `renderPageToRgba` so annotations can be rendered (`FPDF_ANNOT`).
- **New `scripts/lib/fidelity.ts`** with three functions:
  - `snapshotPdf(bytes)` returns per-page data:
    - text character count (PDF.js `getTextContent`)
    - PDFium object counts by type (text, path, image, shading, form)
    - annotation summary (from A-4.4)
    - a render.
  - `compareSnapshots(before, after, {operation, fixture, affectedPages, pageMap, expect})` returns a report with:
    - fixture, operation, page counts
    - affected and unaffected page lists
    - per-page results, each PASS/FAIL with reasons, for both groups
    - overall PASS/FAIL.

    `pageMap` maps source pages to output pages for delete, extract and rearrange.
  - **Unaffected pages** must have identical text and object counts, identical annotations, and a pixel diff within threshold.
  - **Affected pages** must show the intended change, through an `expect` predicate per operation. For example: the watermark adds 1 text object and its characters; rotate changes the rotation while counts stay equal; delete removes a page.
  - Anything else counts as an unexpected change and fails, with an explanation.
- **`formatReport(report)`** prints the readable summary. `test-regression.ts` gets a new section that runs the existing operations through `compareSnapshots`. A failure counts through the existing `check`.
- **Report file:** write JSON plus text to `tests/visual-diff-output/` (already used by A-1.8). Before implementing, I'll confirm that path is gitignored and add it if not.
- **Tests first:** negative cases prove the harness catches problems. Pass a doctored output (an extra rectangle on an "unaffected" page, a dropped page, removed text) and it must FAIL with the right explanation.

### A-4.2 AcroForm filling
- **New `src/lib/pdf/forms.ts`** (pure pdf-lib; runs in Node and the browser).
  - `readFormFields(bytes)` returns `{hasAcroForm, fields[]}`.
    - Each field has `{name, type: text|checkbox|radio|dropdown|optionList|button|signature|unknown, supported, unsupportedReason?, value, options?, multiline, maxLength?, readOnly, required, pageIndexes}`.
    - Unsupported types (button, signature, unknown) are listed with a reason. They are never dropped.
  - `validateFormValues(fields, values)` returns per-field errors. It catches:
    - unknown field names
    - unsupported or read-only targets
    - an option not in the list
    - text over maxLength
    - a non-boolean value for a checkbox
    - multiple selections in a single-select list.
  - `fillForm(bytes, values)` works in four steps:
    1. Validate the values.
    2. Write them with the pdf-lib setters (`setText`, `check`/`uncheck`, `select`), then `updateFieldAppearances`.
    3. Save, reopen and read every field back.
    4. Return `{bytes, verification[]}`. Any mismatch throws.
  - **Errors** use `FormError` with codes `PASSWORD`, `INVALID`, `NO_FORM`, `VALIDATION` and `VERIFY_FAILED`.
- **Fixtures:**
  - A new `scripts/generate-fidelity-fixtures.ts` builds `form-all-fields.pdf` with pdf-lib: text, multiline text, maxLength text, checkbox, radio group, dropdown, option list, read-only text, a button and a signature field (raw dict).
  - Generation is deterministic (fixed dates), and the script appends the new entries to `manifest.json` with sha256. `generate-corpus.ts` is not re-run, so the existing hashes are unchanged.
  - Corrupt and password-protected inputs reuse the existing `password-protected.pdf` plus truncated bytes. Empty forms reuse `simple-text.pdf`.
- **UI:** `useFormFill.ts` + `FormFillPanel.tsx` follow the P3 hook+panel pattern.
  - One input per field type: text and textarea, checkbox, radio, select, multi-select.
  - Unsupported fields are shown disabled with their reason.
  - Inline validation errors, and a "no form fields" empty state.
  - Wiring: register capability `pdf.fill-form`, add the `PdfToolId` "fill-form", and add a Workspace case.
  - The output goes to `results`, and the source file is untouched.
- **Tests (`scripts/test-forms.ts`):**
  - Every field type round-trips through a reopen.
  - Every validation error case.
  - The original bytes are unchanged (sha256 checked before and after).
  - An independent PDF.js `getFieldObjects` read-back confirms the values.

### A-4.3 Flatten
- **`flattenForm(bytes)` in `forms.ts`:**
  1. Inspect the fields and annotations first.
  2. Call `form.flatten({updateFieldAppearances:true})`.
  3. **Remove the dangling widget references** from every page's `/Annots` (fact 2).
  4. Save and reopen, then verify:
     - 0 fields and 0 widget annotations remain
     - no dangling references
     - the non-widget annotations are unchanged (using the A-4.4 comparer)
     - the field values now appear as page text in PDF.js
     - the rendering with `FPDF_ANNOT` before matches the rendering after within threshold, checked in PDFium as an independent renderer.
  5. Return a report.
- **Annotations:** non-widget annotations are left as they are and reported as "kept, not flattened". pdf-lib does not flatten markup annotations. They are **never removed**. Annotation flattening is documented as unsupported.
- **UI:** in `FlattenPanel.tsx`, a pre-check summary shows how many fields will be flattened and how many other annotations are kept, by type. A warning explains the result is irreversible in the exported copy, and the original is kept. An "I understand" checkbox gates the Flatten button. The capability is `pdf.flatten`.
- **Tests (`scripts/test-flatten.ts`):**
  - `form-acroform.pdf` and `form-all-fields.pdf`.
  - A form plus annotations PDF.
  - A no-form PDF, which returns a clear `NO_FORM` error.
  - Password and corrupt inputs.
  - The original bytes are unchanged.
- **Manual check:** open the flattened output in Chrome or Edge's built-in viewer during the browser pass.

### A-4.4 Annotation preservation
- **New `src/lib/pdf/annotations.ts`** (pdf-lib, read-only):
  - `inspectAnnotations(bytes)` returns per-page `{subtype, rect, contents, color, name(/NM), flags, quadPointCount, inkPathCount, hasAppearance, hasPopup}`.
  - `compareAnnotations(before, after, pageMap?)` returns `{countsBefore/After by type, missing[], added[], modified[{field, before, after}]}`. Matching is by `/NM` when present, otherwise by subtype plus rect.
- **Fixtures** (same generator): `annotations-markup.pdf` with these annotations, each carrying an appearance stream so viewers render them:
  - Highlight, Underline, StrikeOut
  - Text note with Popup
  - Ink
  - FreeText, Square/Link as the mixed set
  - a widget (mixed with a form).

  Correct the wrong `annotated.pdf` flag in the manifest (`hasAnnotations:false`). Add one regression check that compares the manifest annotation flags with real `/Annots` counts, so the flag can't drift again.
- **Tests (`scripts/test-annotations.ts`):**
  - Cross-check the inspector against PDF.js `getAnnotations` (independent parser) for every type.
  - Run the existing operations on the fixture and report the real outcome per operation, whatever it is: merge, split, extract, delete, rotate, rearrange, watermark, page numbers, crop, unlock, fillForm, flattenForm.
  - Negative tests: a removed annotation shows as missing, and a moved rect or changed contents shows as modified.
- **Limitations to document:**
  - Inspection reads dictionaries. Appearance-stream *content* changes are not diffed beyond the A-4.1 render diff.
  - Rich text (`/RC`) is not compared.

### Files
- **Create:**
  - `scripts/lib/visual-diff.ts`, `scripts/lib/fidelity.ts`
  - `src/lib/pdf/forms.ts`, `src/lib/pdf/annotations.ts`
  - `scripts/generate-fidelity-fixtures.ts`, `scripts/test-forms.ts`, `scripts/test-flatten.ts`, `scripts/test-annotations.ts`
  - `tests/fixtures/pdf-corpus/{form-all-fields,annotations-markup}.pdf`
  - `src/components/workspace/{useFormFill.ts,FormFillPanel.tsx,FlattenPanel.tsx}`
  - `ALPHA_P4_IMPLEMENTATION_PLAN.md`, `ALPHA_P4_IMPLEMENTATION_REPORT.md`
- **Modify (all Alpha files):**
  - `scripts/test-visual-diff.ts` (import only)
  - `scripts/test-regression.ts` (new sections)
  - `tests/fixtures/pdf-corpus/manifest.json` (append entries; fix the `annotated.pdf` flag)
  - `src/lib/capabilities/registry.ts`, `src/lib/pdf/types.ts`, `Workspace.tsx` (2 tool cases + panels)
  - `package.json` (test scripts only)

### Dependencies
None new. The work uses pdf-lib 1.17.1, pdfjs-dist, and `@embedpdf/pdfium`, which are already installed. No new CDN call sites, because form filling and flattening are pure pdf-lib.

### Beta dependencies
None required. Beta modules are not touched. One observation is reported but not acted on: the editor export path (PDFium via `EditorSession`) is not covered by A-4.4. Measuring it would need Beta's public API, so it goes in the report as a suggested Beta follow-up.

### Risks
- pdf-lib flatten bugs: the dangling references are already found. Radio and checkbox appearances may also be wrong when the source has no appearance stream. Reopen verification and render-diff checks will catch these, and any that remain will be listed in the report rather than hidden.
- The generated annotation fixtures are pdf-lib-made, not from Acrobat or Preview. Real third-party files may have structures they don't cover; this is a documented limitation. If the founder provides a real annotated PDF, it gets added.
- `unlockEncryptedPdf` drops the AcroForm. That is reported as found; fixing it is a separate decision, not P4 scope creep.

### Order (commits on `alpha-phase4`, staged by name, no attribution lines)
1. A-4.1: harness tests, then the refactor and implementation. Run `npm test`, then commit.
2. A-4.4 inspector **first**: the fixtures and `annotations.ts`, because A-4.1's snapshot and A-4.3's verification depend on it. Commit.
3. A-4.2: tests, `forms.ts`, then the UI. Commit.
4. A-4.3: tests, flatten, then the confirmation UI. Commit.
5. Then the rest of A-4.4: the per-operation preservation matrix. Commit.
6. Final verification and the report.

## Verification
- Run `npx tsx` on each new test script; all must pass, including their negative cases.
- `npm test`, which includes the extended regression runner, must exit 0.
- `npm run build` must exit 0. Lint the touched files only.
- In the browser (`npm run dev`, Playwright):
  - Fill `form-all-fields.pdf`, then confirm the output in Outputs, the original in Files, and the values visible when reopened.
  - Check that the flatten confirmation gate works and that the flattened output opens in the browser's own PDF viewer.
  - Check the error states for password-protected, no-form and corrupt files.
- Run `git diff --name-only` against the base and confirm no Beta-owned paths changed. Confirm the corpus sha256 values are unchanged except for the new entries.
