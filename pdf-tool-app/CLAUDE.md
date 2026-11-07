# CLAUDE.md

@AGENTS.md

LayahTools: a browser-first document workspace (PDF first). Next.js 16 App Router, React 19, TypeScript, Tailwind v3.
Document bytes are processed locally in the browser; there is no backend. See `LAYAH_ARCHITECTURE.md` for the
architecture as implemented and `DEVELOPMENT_LOG.md` for current state, decisions and open issues.

## Commands
```bash
npm run dev      # predev copies pdfium.wasm into public/
npm run build    # also the type-check; prebuild copies the wasm (identical file, no diff expected)
npm test         # test-workspace-files.ts + test-editor-session.ts (98 checks at baseline 2fc5270)
npx tsx scripts/<name>.ts   # older model/interaction diagnostics, run individually
```
`npm run lint` has a large legacy backlog; keep the files you touch clean but don't mass-fix it.
Tests are plain `tsx` scripts with assertions on real PDFs in `tests/fixtures/pdfs`. No test framework, no browser
automation. Pure logic goes in `lib/**` and gets a `scripts/test-*.ts` check.

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
sent. Don't add new runtime CDN dependencies without recording them in `LAYAH_ARCHITECTURE.md`.

## Ownership (Alpha / Beta)
See `../2_Beta_Plan_ClaudeCode.md` and `../3_Alpha_Plan_Antigravity.md`; checklist in
`../1_LayahTools_PDF_Workspace_Checklist.md` (these planning files are at the repo root and currently untracked).
- **Beta (Claude Code):** `PdfEditorEngine`, `EditorSession`, Layah model/mapper/interpretation, `EditorController`,
  interaction layer, `PdfViewer` overlay behaviour, `SelectionOverlay`, capability contract, workflow engine.
- **Alpha (Antigravity):** FILES panel and `lib/workspace/files.ts`, sidebar tool pages, pdf-lib/PDF.js tools,
  fixtures/CI/regression harness, loading/error/empty states, capability registration UI.
- If a task needs a change in the other lane, write a request instead of making it. Document what you found.

## Conventions
- Prefer extending existing modules over parallel implementations; keep changes small and in the owning lane.
- Next 16 has breaking changes versus older versions: read `node_modules/next/dist/docs/` before framework code.
- Report results as they are: failing tests, skipped steps and unverified behaviour are stated, not smoothed over.
- Verify interaction with a real mouse/trackpad where possible; scripted pointer events are not a substitute for P0
  acceptance. Native HTML5 drag-and-drop cannot be driven by the in-app browser tool.

## Git safety
- Work on `develop` (or a feature branch from it). `main` is the stable baseline; never rewrite it.
- Baseline: tag `baseline-phase0-2fc5270` (annotated). `known-good-pre-integration` also marks `2fc5270`; leave it alone.
  Tag known-good commits before risky engine changes.
- Never force-push, reset --hard, rewrite history, delete branches/tags, stash, or discard untracked files without
  explicit instruction. Don't commit, push or merge unless asked.
- Audits are read-only unless told otherwise.
- Don't edit or untrack `MEMORY.md`; its status (shared vs private context) is undecided. Don't change
  `package-lock.json` without a recorded decision (see `DEVELOPMENT_LOG.md`, D-05). Don't commit stray
  `public/_t` test files or build output.
