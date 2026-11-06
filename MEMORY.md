# LayahTools (Project-D) — System Memory & Knowledge Base

> **Single Source of Truth for Project Architecture, Design, Engines, and State Management.**

---

## 1. Project Overview & Evolution

* **Product Name:** Layah (formerly FlashPDF / LayahTools).
* **Core Philosophy:** *"One Execution Engine. Multiple Interfaces."*
* **Mission:** Fast, private, browser-first file productivity suite. All core document manipulation runs 100% locally in the client browser with zero server uploads for privacy, speed, and zero infrastructure costs.
* **Evolutionary Context:**
  * **Phase 1 (FlashPDF V1):** Monolithic Next.js + CSS Modules prototype with 8 isolated `pdf-lib` functions.
  * **Current State:** Transitioned into LayahTools with a unified `Workspace`, comprehensive `CAPABILITY_REGISTRY` (17+ tools), multi-engine backend (PDFium WASM + PDF.js + pdf-lib + Tesseract.js), deep interactive PDF editing, document model abstraction, and a refined editorial design system.

---

## 2. Technology Stack

| Layer | Technologies / Libraries |
|---|---|
| **Framework** | Next.js 16.2.3 (App Router, Turbopack ready) |
| **Runtime & Language** | React 19.2.4, TypeScript 5, Node.js |
| **Styling** | Tailwind CSS v3, PostCSS, Autoprefixer (Layah Blue Design System) |
| **Object-Level PDF Editing** | `@embedpdf/pdfium` (PDFium compiled to WASM via Emscripten) |
| **Page-Level Manipulation** | `pdf-lib` v1.17.1 |
| **Rendering & Viewing** | `react-pdf` v10.5.0 + `pdfjs-dist` v6.3.289 |
| **OCR / Text Recognition** | `tesseract.js` v7.0.0 |
| **Test / Diagnostic Runner** | `tsx` scripts with headless simulations and Node-based PDF fixtures |

---

## 3. Architecture & Engine Distribution

The workspace delegates capabilities across specialized engines based on operation depth:

```
[ User Action / AI Intent ]
           │
           ▼
   [ Workspace Shell ]
           │
  ┌────────┼─────────────────┬─────────────────┐
  ▼        ▼                 ▼                 ▼
[pdf-lib] [PDFium WASM]  [PDF.js / Canvas]  [Tesseract.js]
  │        │                 │                 │
Page     Object-level      Rendering /       Scanned PDF
Utils    Visual Edits      Text Extraction   OCR
```

### Engine Distribution Matrix

| Engine | Files / Modules | Primary Operations |
|---|---|---|
| **`pdf-lib`** | `src/lib/pdf/operations.ts`<br>`src/lib/pdf/heavy-operations.ts` | Merge, Split, Extract, Delete, Rotate, Watermark, Page Numbers, Blank PDF, Rearrange, Redact (stamp), Sign (stamp), Structural Compress |
| **PDFium WASM** (`@embedpdf/pdfium`) | `src/lib/pdf/editor/engine.ts`<br>`src/lib/pdf/editor/session.ts` | In-place text editing, text insertion, image insertion/resizing, rectangle outlines, moving/group selections, native C-pointer manipulation |
| **PDF.js (`react-pdf`)** | `src/components/pdf/viewer/PdfViewer.tsx`<br>`src/lib/pdf/intelligence-operations.ts` | High-fidelity canvas rendering, PDF to JPG/PNG rasterization, document text extraction, table extraction heuristics |
| **Tesseract.js** | `src/lib/pdf/heavy-operations.ts` | Client-side OCR worker parsing image-only scans into searchable PDFs |
| **Cloud Boundary (Placeholder)** | `src/lib/pdf/cloud-operations.ts` | PDF to Word / Excel conversion (deliberately isolated for future backend services) |

---

## 4. The Layah Document Model

Located in `src/lib/document/`:
Decouples UI and engine pointers into a clean, canonical geometric model.

* **Coordinate System:** Standard PDF coordinate space (origin at **bottom-left**, dimensions in points `72 pt = 1 inch`).
* **Coordinate Conversion (`coordinates.ts`):** Translates between browser viewport coordinates (`top-left` origin, CSS pixels, zoom-scaled) and PDF points (`bottom-left` origin).
* **Structural Hierarchy:**
  1. **Physical Source Objects (`types.ts`):** Raw objects reflecting PDFium native page objects (`page-N-text-K`, `page-N-image-K`).
  2. **Text Lines (`lines.ts`):** Groups spatial characters/fragments sharing a baseline and font metrics.
  3. **Text Runs (`runs.ts`):** Granular tokenized chunks within lines.
  4. **Text Blocks (`blocks.ts`):** Paragraph-level bounding boxes detected using heuristic spacing.
  5. **Hit Testing (`hittest.ts`):** Point and box intersection algorithms for mouse interactions.
  6. **Document Store (`store.ts`):** In-memory storage of page geometry, objects, and derived layouts.

---

## 5. Editor Session & Transaction Model

Located in `src/lib/pdf/editor/session.ts` and `src/components/pdf/interactive/EditorController.tsx`:

* **Strict Transaction Safety:**
  Every edit executes the cycle:
  `PDFium Native Mutation` ➔ `FPDF_SaveAsCopy` ➔ `Reload exported bytes` ➔ `Rebuild Model & Native Pointer Map`.
  *Native C-pointers never outlive the transaction.* If any mutation throws, the session reverts to the last known byte snapshot.
* **Undo / Redo:** Bounded stack of full byte snapshots (max 20 entries). An undo is literally reloading a known valid byte snapshot, eliminating state drift.
* **Font Coverage Honesty Rule:**
  PDF fonts are often subsetted. If replacing text requires glyphs not embedded in the original font, PDFium silently drops characters. Layah detects this by re-reading the saved result: if text was truncated, the transaction is rolled back and a `FontCoverageError` offers a clean substitute (Helvetica/Times/Courier).
* **Double-Buffering (Flicker Prevention in `PdfViewer.tsx`):**
  When replacing an edited file, react-pdf normally unmounts canvases. `PdfViewer` renders the incoming document off-screen in a hidden container and only swaps once rendered, preserving scroll position and zoom without blank flashes.

---

## 6. Workspace State & Data Ownership

State architecture is cleanly partitioned:

* **File Collection (`src/lib/workspace/files.ts`):**
  * Pure functional logic, zero React dependencies.
  * Append-only file lists with stable identifiers (`f1`, `f2`).
  * Deduplication: Identical re-selections (matching name, size, lastModified) are ignored.
  * In-place replacement: Edits preserve file IDs and list positions via `replaceFile()`.
* **Global UI State (`src/lib/state/app-state.tsx`):**
  * `isWorkspaceActive`: Toggles between landing page and 3-pane studio.
  * `activeFormat`: `"pdf" | "word" | "excel" | "ppt" | "images"`.
  * `activeCapabilityId`: Selected capability in sidebar (e.g. `"pdf.merge"`, `"pdf.edit"`).
* **Output Accumulation:** Outputs accumulate in `results` (newest first). Only explicit user action or clear clears them.

---

## 7. Design System & Brand Identity

Documented in `DESIGN_STATE.md`:
* **Direction:** *Premium Editorial SaaS*. Replaces legacy warm glassmorphism with crisp, authoritative surfaces.
* **Color Palette:**
  * **Brand Gradient:** Vertical hero gradient from deep violet-blue (`#2400c6`) through `#416fe3` to white.
  * **Primary Action:** `#416fe3` (hover: `#2a54dd`).
  * **Surfaces:** Clean opaque whites (`#ffffff`) and slate backgrounds (`#f8f9fa`, `#f1f5f9`).
  * **Borders & Dividers:** Subtle slate-200 (`#e2e8f0`).
* **Typography:**
  * **Headings / Brand:** `Instrument Serif` (editorial, trustworthy).
  * **UI / Controls / Forms:** `Geist Sans` / `Inter` (high legibility).
* **Component Philosophy:** Avoid glassmorphism, bloated padding, or generic component-library aesthetics; keep interfaces focused on the active document.

---

## 8. Directory Map

```
d:\project-D\
├── .gitignore                     # Git ignore rules (includes MEMORY.md)
├── LOGO.png                       # Layah brand logo
├── documents/
│   └── implementation_plan01.md   # Architectural plan for Engine & Workers
└── pdf-tool-app/
    ├── .gitignore                 # App-level git ignore rules
    ├── AGENTS.md                  # Next.js 16 agent rules & directives
    ├── CLAUDE.md                  # Pointers to project guidance
    ├── DESIGN_STATE.md            # Visual specifications & design rules
    ├── LAYAH_ARCHITECTURE.md      # Detailed technical architecture spec
    ├── PROJECT_STATE.md           # Product & capability state summary
    ├── package.json               # Dependencies & scripts
    ├── scripts/                   # Headless test and validation scripts
    │   ├── test-editor-session.ts
    │   ├── test-workspace-files.ts
    │   └── verify-interaction-loop.ts
    ├── public/
    │   └── pdfium.wasm            # Copied by predev/prebuild from node_modules
    └── src/
        ├── app/                   # Next.js App Router (page.tsx, layout.tsx, globals.css)
        ├── components/
        │   ├── pdf/               # Viewer (PdfViewer), Overlays (Sign, Redact, Selection), EditorController
        │   ├── shell/             # LayahShell, EntryState, CommandBar, FormatSwitcher, WorkspaceHeader
        │   └── workspace/         # Workspace (3-pane studio)
        └── lib/
            ├── capabilities/      # Capability registry & metadata
            ├── document/          # Geometry, hit-testing, runs, blocks, store
            ├── pdf/               # Operations (pdf-lib, heavy, intelligence, cloud, editor engine)
            ├── state/             # AppProvider & state context
            └── workspace/         # Pure file handling logic
```

---

## 9. Next Planned Milestones

1. **Web Worker Engine Migration (`implementation_plan01.md`):**
   * Move heavy PDF processing off the main UI thread to prevent UI lockup on 50MB+ files.
   * Provide a web worker hook (`use-pdf-worker.ts`) for asynchronous execution.
2. **Chainable Workflow Pipeline:**
   * Transition isolated single-step tool execution into sequential workflow pipelines where operations pipe `PDFDocument` memory structures directly without intermediate file encoding.
3. **Multi-Format Readiness:**
   * Prepare adapters for Word (`.docx`) and Excel (`.xlsx`) capabilities within the same capability registry shell.
4. **Mobile (React Native / Expo) Parity:**
   * Share pure TypeScript modules (`src/lib/pdf/`, `src/lib/document/`, `src/lib/workspace/`) across Web and React Native.

---

## 10. Completed Implementation — Sprint 1 (Section 7 Gaps Handover)

Implemented directly addressing Section 7 of [`LayahTools_Project_Handover.md`](file:///c:/Users/Lenovo/Downloads/LayahTools_Project_Handover.md):

| # | Feature / Gap Addressed | Files Touched | Details |
|---|---|---|---|
| **1** | **File drag-to-reorder in FILES panel** | `src/lib/workspace/files.ts`<br>`src/components/workspace/Workspace.tsx` | Pure functional `reorderFiles()`, HTML5 draggable row handles with 6-dot grip icons, live drop targets, and "Move to end" zone. |
| **2** | **Merge PDF order transparency** | `src/components/workspace/Workspace.tsx` | Config panel informs users that the right-hand file list order directly controls the merge page sequence. |
| **3** | **Responsive ghost-box drag preview** | `src/components/pdf/interactive/SelectionOverlay.tsx`<br>`src/components/pdf/interactive/EditorController.tsx` | Instant 60fps visual drag with live text preview, type indicators, live delta coordinate badge (`+14pt, -8pt`), and `cursor-grabbing`. PDFium only commits on release. |
| **4** | **Selection corner & mid-side handles** | `src/components/pdf/interactive/SelectionOverlay.tsx` | Visual corner and edge handles added to single and group selections. |
| **5** | **Arrow-key nudging** | `src/components/pdf/interactive/EditorController.tsx` | Selected objects nudge 1pt per Arrow keypress (10pt with Shift) via undoable transaction. |
| **6** | **Keyboard completeness (Ctrl+A)** | `src/components/pdf/interactive/EditorController.tsx` | `Ctrl+A` / `Cmd+A` selects all runs and images on the active page. Tooltips updated. |
| **7** | **Format switcher "Coming Soon" badges** | `src/components/shell/FormatSwitcher.tsx` | Non-PDF formats explicitly marked with "soon" badges and disabled. |
| **8** | **Non-PDF "Start Working" disabled** | `src/components/shell/WorkspaceShell.tsx` | Prevents entering empty workspace for unimplemented formats. |


