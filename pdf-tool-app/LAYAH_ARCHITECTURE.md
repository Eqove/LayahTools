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
`predev`/`prebuild` scripts (so the engine version always matches the installed package). The wasm is a tracked
file; the copy is byte-identical unless the `@embedpdf/pdfium` version changes. `package.json` uses the floating
range `^2.15.0`; the lockfile pins what is actually installed.

**Not everything is local at runtime: see [External runtime dependencies](#external-runtime-dependencies).**

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
- **Selection** lives in `InteractionStateMachine` (selection never spans pages). All pointer-gesture decisions live in
  the pure seam `lib/document/gestures.ts` (`gestureDown/Move/Up/Cancel`, `selectAllOnPage`, `hitCandidates`); the page
  overlay in `EditorController` only translates DOM events into those calls. A press becomes a drag only after
  **6 screen pixels** (`DRAG_THRESHOLD_PX`, passed to the machine as `6 / zoom` PDF points), so trackpad jitter stays a
  click. The machine's own default is 3 PDF points, used only by callers that pass no threshold.
  - `pointercancel` and `lostpointercapture` call `gestureCancel`: the pending gesture is discarded and no intent is
    produced (before B-1.1, cancel was wired to pointer-up and committed the drag).
  - A completed drag whose net displacement is <= `NOOP_MOVE_TOLERANCE_PX` (0.25 CSS px) yields no intent. That is below
    the finest pointer granularity (one device pixel is 0.33 CSS px at 3x DPR), so it absorbs float noise and returning
    to the origin without swallowing any deliberate move (a 1 px net move still commits).
  - Marquee boxes smaller than 4 PDF points (`MARQUEE_MIN_PT`, unchanged) select nothing; this is in points, not
    screen pixels, so it is 2 px at 50% zoom and 8 px at 200%.
  After a mutation, selection is re-derived from source ids (`layoutIdsFor`).
- **Parent sync.** After each edit the controller emits a new `File` to `Workspace` (so other tools and the file list
  see the edited PDF) and tags it so the file effect doesn't re-initialise the session.
- `PdfViewer` takes `preserveScroll` so the viewer keeps its scroll position when the document is swapped.

## Editing features

Select, marquee/shift multi-select, drag-move (single and group), delete, edit existing text, add text
(Helvetica / Times / Courier, size, colour), add image (PNG/JPEG/WebP/GIF decoded in-browser, embedded as a real
PDF image object), resize image (10% steps via Smaller/Larger buttons), outline rectangle, undo/redo, download.

Keyboard (added in Phase 7): Ctrl/Cmd+A selects every run and image on the current page; arrow keys nudge the
selection 1 pt (Shift = 10 pt); Escape resets selection and returns to the Select tool; Delete/Backspace deletes;
Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z undo/redo. **Each nudge is a full mutation** (export + reload + one history snapshot),
so a held arrow key floods the 20-entry history. Coalescing is deferred to P2 together with local drag preview.

Selection overlay: selected boxes are drawn over the viewer; while dragging, a dashed ghost with a text/image preview
follows the pointer and a "Moving (+x pt, +y pt)" badge is shown. The ghost is a visual aid; the PDF is only changed
on release. The 8 corner/edge handles that Phase 7 added were non-interactive and have been removed; real
resize/rotate handles are P2 work.

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
- Pages with `/Rotate` != 0 are not editable (banner shown): coordinate mapping for rotated pages isn't implemented.
- Only text and image objects are modelled. Vector paths/shapes, form fields and annotations are neither selectable nor
  editable (they are preserved untouched). Rectangles can be added but not selected afterwards.
- Scanned (image-only) PDFs open, but there is no text to edit; use OCR (separate tool). Not yet validated on real scans.
- Password-protected PDFs are refused with a clear message in the editor; other tools were not validated against them.
- Each edit re-exports and reloads the whole document (~1 s on a 6-page image-heavy deck). History holds up to 20
  full snapshots with no memory cap. Not tested on documents with hundreds of pages. Files over 50 MB only warn.
- The viewer renders the document twice during a swap (double buffer), briefly raising memory.
- Resize is by 10% buttons, not drag handles; image resize anchors top-left. No object rotation.
- Single-input tools (everything except Merge) run on the active file only; no batch mode.
- **FILES reorder is not accepted.** The pure `reorderFiles()` and the drop handlers reorder correctly when drag events
  are dispatched programmatically, and Merge consumes the visible order (verified: the first page of the merged output
  switches when the list is reordered). But the founder could not reorder with a real mouse, and native drag could not
  be reproduced in the available browser tool (its drags end without delivering a drop, even on a bare test element).
  Suspected cause (unconfirmed): `onDragStart` never calls `dataTransfer.setData`, which Firefox requires to start a
  drag. There are no unit tests for `reorderFiles`, no keyboard (up/down) reorder, and no order numbers in the UI.
- The Merge tool's "File order determines merge order" note is never shown: the Configuration section is hidden for
  merge (`Workspace.tsx`), so the new `ToolFields` branch is unreachable.
- PDF to Word and PDF to Excel are stubs: they wait 800 ms and then always throw "requires a cloud backend".
- `CommandBar` has no handlers; there is no AI/command layer yet.
- `lib/document/identity.ts` (reconciliation) and `validation.ts` are not used by the live editor session, which rebuilds
  the model from scratch after every mutation. Object ids are positional (`page-N-text-K`) and shift after deletes.
- Format switcher: Word/Excel/PowerPoint/Images are disabled with a "soon" badge; "Start working" is disabled for them.
- `package-lock.json` was regenerated by an older npm in the Phase 7 merge and lost its `libc` hints. Decision: keep the
  current lockfile and pin `packageManager: npm@11.13.0`; see `DEVELOPMENT_LOG.md`.

## External runtime dependencies
The product promise is local processing, but these load from third parties in the browser:
- **PDF.js worker**: `//unpkg.com/pdfjs-dist@<version>/build/pdf.worker.min.mjs`, set in 6 places
  (`PdfViewer.tsx`, `heavy-operations.ts`, `intelligence-operations.ts` x4). Without network the viewer cannot render.
  The version is pinned to the installed `pdfjs.version`.
- **Tesseract.js**: `createWorker("eng")` is called with defaults, which fetch the worker, core and `eng` language
  data from a public CDN (default library behaviour; not re-verified at runtime in this audit).
- **Fonts**: `next/font/google` (Geist, Instrument Serif) is resolved at build time and self-hosted; no runtime request.

No document bytes are sent to any of these.

## Phase 7 integration and baseline
- Merge commit `2fc5270` combined `44b5991` (adds a root `MEMORY.md` only; since untracked, see log D-05) and `70c2210` (all Phase 7 code):
  drag-reorder UI in FILES, merge-order note (unreachable), drag ghost + badge, selection handles (now removed),
  arrow nudge, Ctrl+A, Escape reset, "soon" badges in the format switcher.
- Baseline tag `baseline-phase0-2fc5270` (annotated) marks the audited state. `known-good-pre-integration` also points
  at `2fc5270` and is left untouched. `develop` is the working branch; `main` stays the stable baseline.
- Phase 7 shipped no tests. Baseline at `2fc5270`: `npm test` 98 checks pass; `npm run build` succeeds.

## Ownership (Alpha / Beta)
Defined in two planning documents, `2_Beta_Plan_ClaudeCode.md` and `3_Alpha_Plan_Antigravity.md`. **These are
local-only files on the founder's machine (git root, untracked); they are not in the repository.** The lane summary
below and the repository-root `CLAUDE.md` are the version available to anyone who clones the repo.
- **Beta (Claude Code):** `PdfEditorEngine`, `EditorSession`, Layah model/store/mapper, interpretation, `EditorController`,
  interaction layer, `PdfViewer` overlay behaviour, `SelectionOverlay`, capability contract, workflow engine.
- **Alpha (Antigravity):** FILES panel and `lib/workspace/files.ts`, sidebar tool pages, pdf-lib/PDF.js tools, fixtures
  and regression harness/CI, loading/error/empty states, capability registration UI, provider abstraction.
- Cross-lane changes are requested, not made. Example: the merge-note bug and FILES reorder are Alpha items (A-1.1);
  this document records their state but they were not fixed during Phase 0.
- Other local-only planning documents (also untracked, not in the repository): `1_LayahTools_PDF_Workspace_Checklist.md`
  (gates P0-P7 and item IDs such as A-1.1), `LayahTools_Development_Phases.md`, `LayahTools_Master_Context.md`,
  `LayahTools_Project_Handover.md/.docx`. Item IDs and gates cited in this repo (A-1.1, P1, P2, "checklist P0") refer to
  those files and cannot be looked up by a cloner. The tracked running log is `DEVELOPMENT_LOG.md`.

## Testing
- **B-1.1 invariant, `npm test` -> `scripts/test-no-mutation.ts` (62 checks):** non-editing interactions never mutate the
  PDF. It drives the real `gestures.ts` seam with a real state machine and `EditorSession` on real PDFs and applies every
  returned move intent like the controller does. `scripts/lib/mutation-probe.ts` (test-only, reusable) counts engine
  mutations, exports, reloads, raw PDFium calls, `generation`, history depth and byte identity without any production
  change. Positive controls (drag-move, nudge, delete, undo) prove the counters move; two controlled violations prove a
  leak is caught. Not covered: the React event wiring itself and `PdfViewer` zoom/page-navigation state (the latter is
  only checked structurally: the viewer source does not reference the session/engine).
- `npm test` runs `scripts/test-workspace-files.ts` (15 checks on the file collection; `reorderFiles` is not covered)
  then `scripts/test-editor-session.ts` (83 checks): real PDFs (`tests/fixtures/pdfs`), move/group/replace/delete/add text/
  image/rect/resize/undo/redo, **independent reload** in a fresh engine and pdf-lib, rollback on bad ids, malformed PDF.
- Older model tests: `npx tsx scripts/test-{geometry,lines,runs,blocks,editor-interaction,document-model,document-validation,reconciliation,pdfium-engine}.ts`.
- `scripts/verify-interaction-loop.ts` is a headless coordinate/hit-test simulation (not a browser test).
- No automated browser tests exist. Browser checks so far used scripted pointer events; a physical mouse/trackpad
  acceptance test is still outstanding (checklist P0). Phase 7 UI (overlay, shortcuts, FILES panel) has no automated coverage.

## Future formats (readiness only — nothing built)
The seam is `EditorSession`'s *shape*, not its PDFium internals: open(bytes) → model → intent-based mutations →
bytes, with snapshot history. A DOCX/PPTX/XLSX engine would provide the same four things behind a format-specific
adapter, and the capability registry would route by file type. The Layah Document Model is currently page/geometry
shaped (right for PDF/PPTX slides; DOCX needs a flow/paragraph model and XLSX a cell/sheet model), so expect new
model types rather than stretching `LayahPage`. AI orchestration should emit the same mutation intents
(`lib/document/mutation.ts`) the UI does; add `replaceText`, `addText`, `addImage`, `resize` to that union when a
command layer needs them (they currently live as `EditorSession` methods).
