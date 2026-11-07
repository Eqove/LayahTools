# CLAUDE.md (app)

@AGENTS.md

App-specific notes for `pdf-tool-app/`. Project-wide rules (architecture, ownership, git safety, local-only files) are in
the repository root `../CLAUDE.md`; architecture as implemented is in `LAYAH_ARCHITECTURE.md`; state, decisions and open
issues are in `DEVELOPMENT_LOG.md`.

Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind v3. Package manager pinned to `npm@11.13.0`
(`packageManager` in `package.json`); keep `package-lock.json` as written by that version.

## Commands (run from this folder)
```bash
npm run dev      # predev copies node_modules/@embedpdf/pdfium/dist/pdfium.wasm to public/pdfium.wasm
npm run build    # also the type-check; prebuild does the same copy (file is tracked; no diff expected)
npm test         # test-workspace-files.ts + test-editor-session.ts (98 checks at baseline 2fc5270)
npx tsx scripts/<name>.ts   # older model/interaction diagnostics, run individually
```
`npm run lint` has a large legacy backlog; keep files you touch clean but don't mass-fix it.

## Layout
- `src/lib/pdf/editor/` engine (PDFium) and `EditorSession`; `src/lib/document/` engine-independent model.
- `src/lib/pdf/operations.ts`, `heavy-operations.ts`, `intelligence-operations.ts` pdf-lib / PDF.js / Tesseract tools.
- `src/lib/workspace/files.ts` pure file-collection logic. `src/components/workspace/Workspace.tsx` workspace shell.
- `src/components/pdf/` viewer (`PdfViewer`) and interactive overlays (`EditorController`, `SelectionOverlay`).
- `scripts/` tests and diagnostics (plain `tsx` + assertions, real PDFs from `tests/fixtures/pdfs`). No test
  framework and no browser automation. Pure logic goes in `src/lib/**` and gets a `scripts/test-*.ts` check.

## App-specific rules
- Next 16 has breaking changes versus older versions: read `node_modules/next/dist/docs/` before framework code.
- `public/pdfium.wasm` is copied, not hand-edited; it changes only when `@embedpdf/pdfium` does.
- `pdf-tool-app/.next-build/` contains tracked build output (109 files). Don't edit it; cleanup is an open item in
  `DEVELOPMENT_LOG.md`.
