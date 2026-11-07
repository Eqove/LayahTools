# CLAUDE.md

Project instructions for LayahTools, a browser-first document workspace (PDF first). Document bytes are processed
locally in the browser; there is no backend.

## Repository structure
```
/                          git root (branch `develop` for work, `main` stable)
  CLAUDE.md                this file: project-wide rules
  .gitignore               also ignores MEMORY.md and .agent-memory/ (private agent memory)
  LOGO.png
  documents/               early implementation plan
  pdf-tool-app/            the Next.js 16 application (everything runnable lives here)
    CLAUDE.md, AGENTS.md   app-specific commands and Next.js caveats (loaded when working in this folder)
    LAYAH_ARCHITECTURE.md  architecture as implemented (source of truth)
    DEVELOPMENT_LOG.md     state, decisions, open issues
    src/  scripts/  tests/fixtures/pdfs/  public/
```
Run all npm commands from `pdf-tool-app/`. See `pdf-tool-app/CLAUDE.md`.

## Local-only files (not in the repository)
These exist only on the founder's machine at the git root and are **untracked**. Someone who clones the repo will not
have them, so never make tracked code or docs depend on them. Do not add, move, edit or delete them unless told to.
- `1_LayahTools_PDF_Workspace_Checklist.md` (gates and checklist)
- `2_Beta_Plan_ClaudeCode.md`, `3_Alpha_Plan_Antigravity.md` (lane ownership)
- `LayahTools_Development_Phases.md`, `LayahTools_Master_Context.md`
- `LayahTools_Project_Handover.md`, `LayahTools_Project_Handover.docx`

`MEMORY.md` (git root) is private agent memory: untracked and ignored. Leave its contents alone.

## Architecture rules (do not break)
- PDF.js (react-pdf) renders and interprets. PDFium WASM (`lib/pdf/editor/engine.ts`) manipulates native objects.
  pdf-lib does proven page-level operations and creation. Tesseract.js does OCR. Don't make one engine do another's job.
- Only `engine.ts` touches PDFium pointers (`ptr_*`). They never enter `lib/document/*` or anything serializable.
- Every editor mutation goes through `EditorSession` (apply -> export -> reload -> rebuild model). UI code never calls the engine.
- **Selection is not a mutation.** Selecting, hovering, marquee, select-all and keyboard navigation must never export,
  reload, or swap the PDF.js file. A press becomes a drag only after 6 screen pixels (`6 / zoom` PDF points passed to
  `InteractionStateMachine.pointerMove`; the machine's own default is 3 pt for headless callers).
- The Layah document model (`lib/document`) stays engine-independent; `mapper.ts` is the only adapter.
- Coordinates: PDF space is bottom-left origin in points; viewport space is top-left in CSS pixels. Convert only via
  `lib/document/coordinates.ts`.
- AI/command code (future, not built) emits intents. It never edits document bytes directly.
- Workspace state (`Workspace.tsx`): `items` (uploaded files, append-only, stable ids), `activeFileId`, `results`
  (accumulating outputs). Tools read these and never remove or replace files; only explicit user actions do. Edits swap
  bytes with `replaceFile`, keeping the id.
- Keep the `PdfViewer` double buffer (`preserveScroll`) for any editing UI so mutations don't blank the viewer.
- No placeholder controls: if something isn't wired up, don't render it (or disable it with a stated reason).
- Don't claim universal PDF editing. Unsupported today: rotated pages, vector shapes, forms, annotations, object rotation.

## Known external dependencies (not offline-capable)
The PDF.js worker loads from `unpkg.com` (6 call sites); Tesseract.js uses default CDN assets. No document bytes are
sent. Don't add new runtime CDN dependencies without recording them in `pdf-tool-app/LAYAH_ARCHITECTURE.md`.

## Ownership (Alpha / Beta)
Two lanes share the repo; the plans that define them are local-only (above).
- **Beta (Claude Code):** `PdfEditorEngine`, `EditorSession`, Layah model/mapper/interpretation, `EditorController`,
  interaction layer, `PdfViewer` overlay behaviour, `SelectionOverlay`, capability contract, workflow engine.
- **Alpha (Antigravity):** FILES panel and `lib/workspace/files.ts`, sidebar tool pages, pdf-lib/PDF.js tools,
  fixtures/CI/regression harness, loading/error/empty states, capability registration UI.
- If a task needs a change in the other lane, write a request instead of making it, and document what you found.

## Conventions
- Prefer extending existing modules over parallel implementations; keep changes small and in the owning lane.
- Report results as they are: failing tests, skipped steps and unverified behaviour are stated, not smoothed over.
- Verify interaction with a real mouse/trackpad where possible; scripted pointer events are not a substitute for
  acceptance. Native HTML5 drag-and-drop cannot be driven by the in-app browser tool, so FILES reorder (A-1.1) stays
  open until a human tests it.
- Don't add speculative fixes without evidence.

## Git safety
- Work on `develop` (or a feature branch from it). `main` is the stable baseline; never modify or rewrite it.
- Baseline: annotated tag `baseline-phase0-2fc5270`. `known-good-pre-integration` also marks `2fc5270`; leave it alone.
  Tag known-good commits before risky engine changes.
- Never force-push, reset --hard, rewrite history, delete branches/tags, stash, or discard untracked files without
  explicit instruction. Don't commit, push or merge unless asked. Stage files by name, never `git add -A`.
- Audits are read-only unless told otherwise.
- The package manager is pinned (`packageManager: npm@11.13.0` in `pdf-tool-app/package.json`). Don't change
  `package-lock.json` or dependency versions without a recorded decision.
- Don't commit stray `public/_t` test files or build output.
