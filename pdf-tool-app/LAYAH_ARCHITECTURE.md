# LayahTools — Architecture (as implemented)

```
USER INTENT → COMMAND LAYER → CAPABILITY REGISTRY → DOCUMENT ENGINES → RESULT
```

All PDF work runs in the browser; there is no backend. AI/command orchestration is a placeholder UI
(`CommandBar`); the capability registry and engines below are real.

## Engines

| Concern | Engine | Where |
|---|---|---|
| Rendering / viewing | PDF.js via react-pdf | `components/pdf/viewer/PdfViewer.tsx` |
| Page-level utilities (merge, split, rotate, watermark, page numbers, redact, sign, compress, rearrange, blank) | pdf-lib | `lib/pdf/operations.ts`, `heavy-operations.ts` |
| OCR, text/structure/table extraction, PDF→image | Tesseract.js, PDF.js | `lib/pdf/intelligence-operations.ts` |
| Object-level editing | PDFium WASM (`@embedpdf/pdfium`) | `lib/pdf/editor/engine.ts` |

PDFium WASM is served same-origin from `public/pdfium.wasm`, copied from `node_modules` by the
`predev`/`prebuild` scripts (so the engine version always matches the installed package; no CDN at runtime).

## Editor stack

```
EditorController (React: toolbar, overlays, keyboard)
   └─ EditorSession  (lib/pdf/editor/session.ts)   ← all mutations, history, id resolution
        ├─ PdfEditorEngine  (engine.ts)             ← only place that touches PDFium pointers
        └─ Layah Document Model (lib/document/*)    ← pages → source objects; derived lines/runs/blocks
```

- **Source objects** (`page-N-text-K`, `page-N-image-K`) mirror PDFium page objects. **Runs / blocks** are derived
  layout (ids like `run-3`, `block-1`, unique *per page only*). Any intent targeting a run/block is resolved to
  source objects by `EditorSession.resolveSourceIds`, so group moves/deletes touch every underlying object.
- **Transaction model.** Each mutation = apply in PDFium → `FPDF_SaveAsCopy` → reload the exported bytes →
  rebuild model. The id→native-pointer map and all PDFium page handles are replaced on every reload, so a stale
  pointer cannot be reused; an id deleted earlier in the same transaction is dropped from the map. If anything
  throws, the last good bytes are reloaded and the error is surfaced (document is never left half-edited).
- **Undo/redo** = stack of exported byte snapshots (max 20). Undo reloads a snapshot; it cannot drift from the file.
- **Selection** lives in `InteractionStateMachine` (selection never spans pages; 3pt drag threshold).
  After a mutation, selection is re-derived from source ids (`layoutIdsFor`).
- **Parent sync.** After each edit the controller emits a new `File` to `Workspace` (so other tools and the file list
  see the edited PDF) and tags it so the file effect doesn't re-initialise the session.
- `PdfViewer` takes `preserveScroll` so the viewer keeps its scroll position when the document is swapped.

## Editing features

Select, marquee/shift multi-select, drag-move (single and group), delete, edit existing text, add text
(Helvetica / Times / Courier, size, colour), add image (PNG/JPEG/WebP/GIF decoded in-browser, embedded as a real
PDF image object), resize image (10% steps), outline rectangle, undo/redo, download.

### Text-edit honesty rules
PDFium's `FPDFText_SetText` **silently drops characters** the original (usually subsetted) font has no glyph for.
After every in-place edit the result is re-read from the reloaded document; if text was lost the edit is rolled back
and a `FontCoverageError` is shown with an explicit "Use Helvetica instead" action (which deletes the original
object and inserts Helvetica text at the same position/size/colour). Multi-fragment lines are merged into the first
fragment (the UI says so). New text may be wider/narrower than the old; nothing reflows.

## Workspace state ownership

| State | Owner | Notes |
|---|---|---|
| Uploaded files | `Workspace` `items` (`lib/workspace/files.ts`, pure + tested) | Append-only; identical re-selection (name+size+mtime) skipped, same name/different content kept; removal only via the file's ✕; ids stable (edits swap bytes via `replaceFile`, keep id) |
| Active document | `Workspace` `activeFileId` | Click a file to activate; single-input tools and the viewer/editor use it. Merge uses all files. Nothing else consumes or removes files |
| Active tool | `AppProvider.activeCapabilityId` | Switching tools never touches files or outputs |
| Outputs | `Workspace` `results` | Accumulate (newest first); only the Clear button empties them |
| Document mutations / undo | `EditorSession` (one per active file; `EditorController` keyed by file id) | History lives only while that editor is mounted; switching tool or file discards it (edited bytes are kept in the file entry) |
| Interaction (selection, drag, marquee, edit mode) | `InteractionStateMachine` + `EditorController` state | **Never** exports/reloads or touches the PDF.js document |

## Viewer stability (flicker)
Root cause: a click with a few pixels of pointer jitter crossed the 3pt drag threshold and became a *move* mutation;
every mutation swaps the `file` given to react-pdf `<Document>`, which enters its loading state and unmounts all
pages/canvases (measured: 3 page wrappers removed, rebuilt ~140 ms later). Fixes: (1) drag threshold is now 6 screen px
(`6 / zoom` pt), so selecting is not a mutation; (2) `PdfViewer` double-buffers when `preserveScroll` is set: the new
file loads in a hidden `<Document>` and swaps in only after its pages have painted (4 s safety timeout), so real
mutations also never blank the viewer. Measured in the browser: visible canvases never dropped below 3 during a jittery
click or a real drag-move, at 100% and 150% zoom; scroll position and zoom are retained.

## Hydration warning
`bis_skin_checked` is injected by the Bitdefender browser extension into server-rendered `<div>`s before React
hydrates. Verified: SSR HTML contains 0 occurrences; in an extension-free browser the DOM has 0 and there is no
hydration warning; no application code renders dates/random/`window`-dependent values during render (`window` use is
inside effects). Not an application defect; disable the extension (or use a private window) to confirm. No
`suppressHydrationWarning` was added.

## Known limitations
- Pages with `/Rotate` ≠ 0 are not editable (banner shown) — coordinate mapping for rotated pages isn't implemented.
- Only text and image objects are modelled. Vector paths/shapes, form fields and annotations are neither selectable nor
  editable (they are preserved untouched). Rectangles can be added but not selected afterwards.
- Scanned (image-only) PDFs open, but there is no text to edit; use OCR (separate tool).
- Password-protected PDFs are refused with a clear message; unlock first.
- Each edit re-exports and reloads the whole document (~1s on a 6-page image-heavy deck). History holds up to 20
  full snapshots, so very large files use a lot of memory. Not tested on documents with hundreds of pages.
- Edits briefly render the document twice (double buffer) so memory spikes by one extra pdf.js document during a swap; no live drag preview of text — a ghost box follows the pointer.
- Single-input tools (everything except Merge) run on the active file only; no batch mode yet. Files over 50 MB trigger a warning, not a block.
- Resize is by 10% buttons, not drag handles. Image resize anchors top-left.

## Testing
- `npm test` → `scripts/test-editor-session.ts`: real PDFs (`tests/fixtures/pdfs`), move/group/replace/delete/add text/
  image/rect/resize/undo/redo, **independent reload** in a fresh engine and pdf-lib, rollback on bad ids, malformed PDF.
- Older model tests: `npx tsx scripts/test-{geometry,lines,runs,blocks,editor-interaction,document-model,document-validation,reconciliation,pdfium-engine}.ts`.
- `scripts/verify-interaction-loop.ts` is a headless coordinate/hit-test simulation (not a browser test).

## Future formats (readiness only — nothing built)
The seam is `EditorSession`'s *shape*, not its PDFium internals: open(bytes) → model → intent-based mutations →
bytes, with snapshot history. A DOCX/PPTX/XLSX engine would provide the same four things behind a format-specific
adapter, and the capability registry would route by file type. The Layah Document Model is currently page/geometry
shaped (right for PDF/PPTX slides; DOCX needs a flow/paragraph model and XLSX a cell/sheet model), so expect new
model types rather than stretching `LayahPage`. AI orchestration should emit the same mutation intents
(`lib/document/mutation.ts`) the UI does; add `replaceText`, `addText`, `addImage`, `resize` to that union when a
command layer needs them (they currently live as `EditorSession` methods).
