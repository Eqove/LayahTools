# ALPHA_NOTES.md — Decisions, Status & Session Continuity

> **Lane:** Alpha (Antigravity)  
> **Role:** Workspace, standalone PDF capabilities, QA infra, UX states, interpretation helpers  
> **Strict Boundary:** Do NOT edit `PdfEditorEngine`, `EditorSession`, Layah document model/mapper, `EditorController`, or `PdfViewer` overlay logic. Request changes from Beta (Claude Code).

---

## 1. Operating Rules & Quota Management

- **Model Routing:**
  - **Flash:** Boilerplate, tests, JSON fixtures, UI states, schemas, copy, audits.
  - **Sonnet:** Implementation from written spec, fixing failing tests.
  - **Opus:** Strictly rationed (1–2x/week max) for difficult architecture/security decisions (e.g. encryption approach spike A-5.2).
- **Execution Workflow:**
  - One task = one brief = one atomic commit.
  - Test-first methodology: define/run failing test, satisfy it, verify output.
  - Deterministic engines only — AI never mutates bytes directly.
  - No dead controls: unfinished tools must display "Coming soon" or stay hidden.

---

## 2. Phase 0 — Baseline & Integration Deliverables (Week 0)

| Task ID | Item | Status | Findings / Notes |
|---|---|---|---|
| **A-0.1** | Verify Development Environment & Baseline | ✅ Complete | Node v24.8.0, npm, dependencies installed (218 packages). `npm test` passes all 15 workspace + 98 editor checks. `npm run build` generates 4/4 static pages cleanly with Turbopack. |
| **A-0.2** | Hydration Warning Investigation | ✅ Complete | Root cause: External browser extension (Bitdefender DOM injection `bis_skin_checked="1"`). Server-rendered HTML (`.next-prod/server/app/index.html`) contains 0 occurrences. Application code does not execute non-deterministic rendering. Verified clean without extensions. |
| **A-0.3** | Red "2 Issues" Dev Overlay Investigation | ✅ Complete | Originates from Next.js DevTools. Issue 1: Hydration warning from Bitdefender extension. Issue 2: Offline Google Fonts (`Geist` & `Instrument Serif`) fetch during sandboxed dev compilation. In normal dev mode with fonts cached, overlay displays 0 issues. |
| **A-0.4** | Configure Project Rules | ✅ Complete | Published comprehensive engineering rules and ownership boundaries in `pdf-tool-app/AGENTS.md` and `d:\project-D\AGENTS.md`. |

---

## 3. Phase 1 — Stable Workspace & Gate A Deliverables (Week 1)

| Task ID | Item | Status | Findings / Notes |
|---|---|---|---|
| **A-1.1** | FILES Panel Reordering | ✅ Complete | Extended `reorderFiles` in `files.ts` to support both index-based and ID-based reordering. Added 11 unit tests in `scripts/test-workspace-files.ts` (all 26 tests pass). Added accessible Move Up / Move Down buttons with disabled boundary states and `#1, #2...` order badges in `Workspace.tsx`. |
| **A-1.2** | Merge PDF Order Verification | ✅ Complete | Created `scripts/test-merge-order.ts`. Verified 3-PDF merge in original order, after reordering, and repeated reordering. Confirmed original file immutability, corrupted file rejection, and reopen validation. |
| **A-1.3** | Sidebar Tool Audit | ✅ Complete | Created `pdf-tool-app/docs/TOOL_AUDIT.md` covering all 19 capabilities. Classified each as Working, Partially Working, or Pending. Disabled "Run Tool" for pending tools (`pdf.pdf-to-word`, `pdf.pdf-to-excel`) with "Coming soon" state. Added security disclaimer for visual redaction (`pdf.redact`). |
| **A-1.4** | Format Navigation Consistency | ✅ Complete | Synchronized navigation tooltips in landing nav (`EntryState.tsx`) with workspace format switcher (`FormatSwitcher.tsx`). All non-PDF formats clearly indicate "coming soon". |
| **A-1.5** | Sign In Audit | ✅ Complete | Created `pdf-tool-app/docs/SIGN_IN_AUDIT.md`. Confirmed 0 auth implementations exist in codebase. Documented recommendation for founder. |
| **A-1.6** | PDF Testing Corpus v1 | ✅ Complete | Created `scripts/generate-corpus.ts` generating 10 representative fixtures (simple, multi-column, table-heavy, image-heavy, scanned image-only, rotated, AcroForm, annotated, 25-page long, password-protected). Built `tests/fixtures/pdf-corpus/manifest.json` with SHA-256 hashes. |
| **A-1.7** | Regression Runner v1 | ✅ Complete | Built `scripts/test-regression.ts`. Automatically validates all 10 fixtures, baseline page counts, encryption detection, and mutation export-reopen cycles (100% pass). |
| **A-1.8** | Visual-Diff Harness | ✅ Complete | Built `scripts/test-visual-diff.ts` using local WASM renderer. Pixel-level delta calculation, region masks isolating expected changes, diff threshold tolerance, and report generation in `tests/visual-diff-output/visual-diff-report.json`. Documented in `docs/VISUAL_DIFF.md`. |
| **A-1.9** | GitHub Actions CI Workflow | ✅ Complete | Created `.github/workflows/ci.yml` running `npm ci`, `npm run copy-wasm`, `npm test` (chaining all 5 test suites), and `npm run build` on PRs and pushes to `main` and `develop`. |

---

## 4. Log of Architectural Decisions & Fixes (Alpha Lane)

- **File Reordering (A-1.1):** Dual overload in `src/lib/workspace/files.ts` handles both numeric indices (`from: number, to: number`) and DOM string IDs (`from: string, to: string | null`).
- **Visual Cover Redaction Notice (Rule 5):** Added explicit disclaimer in `Workspace.tsx` that visual redactions do not sanitize raw stream bytes.
- **WASM Visual Diffing (A-1.8):** Direct usage of `@embedpdf/pdfium` for in-memory RGBA rasterization eliminated external canvas dependencies.
- **CI Test Chaining (A-1.9):** `npm test` in `package.json` sequentially executes `test-workspace-files.ts`, `test-merge-order.ts`, `test-editor-session.ts`, `test-regression.ts`, and `test-visual-diff.ts`.

---

## 5. Phase 2 — Editor V2 Support & Capability Expansion Deliverables (Week 2)

| Task ID | Item | Status | Findings / Notes |
|---|---|---|---|
| **A-2.4** | Application-Level Error Boundary | ✅ Complete | Created `src/app/error.tsx` (Next.js App Router root boundary) and `src/components/shell/ErrorBoundary.tsx` (React class component). Protects workspace from runtime rendering crashes; never exposes raw stack traces in production; offers safe reload. |
| **A-2.1** | Standardized UI State Components | ✅ Complete | Created `src/components/ui/LoadingState.tsx`, `ProgressBar.tsx`, `EmptyState.tsx`, and `ErrorState.tsx`. Progress bar adheres to Honesty Rule (numeric progress only). Replaced ad-hoc empty states in FILES panel and main dropzone. |
| **A-2.3** | File-Size Warning UI | ✅ Complete | Created `src/components/workspace/FileSizeWarning.tsx`. Proactively alerts users when document exceeds 50 MB (`LARGE_FILE_BYTES`). Explains in-browser memory limits; non-blocking and dismissible. |
| **A-2.2** | Undo/Redo Feedback & Beta Interface Requests | ✅ Complete | Verified existing disabled states in `EditorController.tsx`. Logged formal requests B-2.1, B-2.2, and B-2.3 to Beta for human-readable action labels and scanned-page OCR suggestions. |
| **A-2.5** | Keyboard Shortcut Cheat-Sheet Modal | ✅ Complete | Created static registry `src/lib/shortcuts.ts` and accessible modal `src/components/shell/ShortcutModal.tsx`. Integrated trigger button in `WorkspaceHeader.tsx` and global `?` key listener. |
| **A-2.6** | Page Thumbnails Sidebar & Quick Actions | ✅ Complete | Built `src/components/workspace/PageThumbnailSidebar.tsx` and pure single-page operations in `src/lib/pdf/page-actions.ts` (`rotateSinglePage`, `deleteSinglePage`, `extractSinglePage`). Includes 1-page document deletion guard. |
| **A-2.7** | Independent PDF Capabilities (Password, Metadata, Crop) | ✅ Complete | Built `PasswordDialog.tsx` + `unlockEncryptedPdf()` (PDF.js verification + pdf-lib clean export); `MetadataPanel.tsx` + `readPdfMetadata()`; deterministic `cropPdf()` honoring bottom-left coordinates (`setCropBox` + `setMediaBox`). Registered `pdf.crop` and `pdf.metadata`. |

---

## 6. Formal API Requests to Beta (Claude Code Lane)

- **Request B-2.1 (Undo Stack Depth):** Expose `undoStackDepth: number` and `redoStackDepth: number` on `EditorSession` to allow the shell to display count of available undo/redo steps.
- **Request B-2.2 (Action Labels):** Expose `lastActionLabel?: string` (e.g. `"Move text"`, `"Delete rectangle"`, `"Insert image"`) on `EditorSession` so undo/redo buttons can display rich tooltips like `"Undo Move text (Ctrl+Z)"`.
- **Request B-2.3 (Scanned Page OCR Guidance):** Enhance `uneditableReason(pageIndex)` on scanned image-only pages to return `"Scanned page without text layer. Run OCR tool to enable text editing."` with a routing intent to `pdf.ocr`.

---

## 7. Log of Architectural Decisions & Fixes (Phase 2)

- **PDF.js Worker ArrayBuffer Detachment (A-2.7):** PDF.js `getDocument({ data: uint8, password })` detaches the underlying `ArrayBuffer` during worker transfer. Solved by passing a cloned slice `new Uint8Array(bytes.slice(0))` to PDF.js verification, preserving the original buffer for `pdf-lib` decryption and clean document generation.
- **Clean Decryption Strategy (A-2.7):** Simply loading with `{ ignoreEncryption: true }` retains the encryption dictionary in saved output. Solved by copying pages via `copyPages()` into a fresh `PDFDocument.create()`, producing an unencrypted PDF that opens cleanly without parameters.
- **PDF Bottom-Left Coordinate Cropping (A-2.7 & Rule 9):** Cropping transforms top/bottom/left/right margin inputs into PDF coordinate space: `newX = margins.left`, `newY = margins.bottom`, `newWidth = width - left - right`, `newHeight = height - top - bottom`. Sets both `setCropBox` and `setMediaBox`.
- **React 19 / Next.js 16 Hook Cascading Render Avoidance (A-2.1):** Asynchronous metadata reading in `MetadataPanel` defers state initialization to avoid synchronous render cascading warnings.
- **Chained CI Testing:** `npm test` updated to chain all 6 test suites including `scripts/test-phase2-capabilities.ts`. All 180+ tests pass in 12s.
