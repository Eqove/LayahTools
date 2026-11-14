# Layah

**A browser-first PDF workspace.** Open a PDF, work on it, download the result. Your documents are processed on your own device, and there is no backend.

<p>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6">
  <img alt="Runs in the browser" src="https://img.shields.io/badge/processing-in%20the%20browser-success">
</p>

---

## What it does

Layah brings everyday PDF jobs into one workspace. Upload one or more files, pick a tool from the sidebar, and download the result. The original file is never changed.

| Group | Tools |
|---|---|
| **Organize** | Merge, Split, Extract Pages, Delete Pages, Rotate, Rearrange Pages, Page Numbers, Crop, Compress, Edit PDF |
| **Create** | Create Blank PDF, Sign PDF |
| **Secure** | Add Watermark, Redact PDF |
| **Understand** | OCR, Extract Text, Analyze Structure, Extract Tables, Document Properties |
| **Convert** | PDF to JPG/PNG |

**Edit PDF** works directly on the objects inside the page. You can select, move, delete and edit existing text, add text, images and rectangles, and undo or redo your changes.

### Honest limits

Layah says what it can't do rather than guessing:

- **Redact** draws a cover over the content. It does **not** remove the underlying text, so it is not secure redaction.
- **Sign** adds a visual signature. It is not a cryptographic digital signature.
- **Compress** rebuilds the file structure. It does not downsample images.
- **Edit PDF** doesn't support rotated pages, vector shapes, form fields, annotations or object rotation. Scanned (image-only) pages have no text to edit, so run OCR first.
- **Extract Tables** is a rough heuristic, not full table understanding.
- **PDF to Word** and **PDF to Excel** are shown as *Coming soon*. They need a conversion backend that doesn't exist yet.

## Privacy

Document bytes are read and processed in your browser. Nothing is uploaded to a Layah server, because there isn't one.

Two things are still fetched from the internet at runtime, and neither carries your document:

- the PDF.js worker, loaded from `unpkg.com`
- the Tesseract.js worker and English language data used for OCR, loaded from its default CDN

So Layah needs a network connection today and is not yet fully offline.

## Quick start

You need **Node.js** and **npm**. The project pins npm `11.13.0` and is developed on Node 24.

```bash
git clone https://github.com/Eqove/LayahTools.git
cd LayahTools/pdf-tool-app
npm install
npm run dev
```

Open <http://localhost:3000>. The `dev` and `build` scripts copy the PDFium WebAssembly file into `public/` for you.

### Commands

Run these from `pdf-tool-app/`.

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and create a production build |
| `npm start` | Serve the production build |
| `npm test` | Run the automated test suites (workspace files, merge order, editor session, no-mutation, session contract, regression, visual diff, Phase 2 capabilities) |
| `npm run lint` | Run ESLint. The project has an existing lint backlog, so keep the files you touch clean rather than fixing everything at once |

## How it works

Each job is given to the engine that is best at it:

| Job | Engine |
|---|---|
| Showing pages and reading text | [PDF.js](https://mozilla.github.io/pdf.js/) via `react-pdf` |
| Page-level operations and creating PDFs (merge, split, rotate, watermark, crop, and so on) | [pdf-lib](https://pdf-lib.js.org/) |
| Editing the objects inside a page | [PDFium](https://pdfium.googlesource.com/pdfium/) (WebAssembly, via `@embedpdf/pdfium`) |
| OCR | [Tesseract.js](https://tesseract.projectnaptha.com/) |

Every tool is registered in one place, the capability registry (`pdf-tool-app/src/lib/capabilities/registry.ts`), so the sidebar and the tools share a single list. The editor never changes a PDF directly. All edits go through an `EditorSession` that applies the change, exports the file, reloads it and rebuilds the model, so a failed edit can't leave a half-edited document.

## Project layout

```
.
├── README.md
├── LOGO.png
└── pdf-tool-app/               The Next.js application (everything runnable lives here)
    ├── src/
    │   ├── app/                Next.js App Router entry points
    │   ├── components/         Workspace shell, viewer, editor overlays, shared UI states
    │   └── lib/
    │       ├── capabilities/   Tool registry
    │       ├── document/       Engine-independent document model (pages, lines, blocks, geometry)
    │       ├── pdf/            pdf-lib, PDF.js and OCR tools; editor engine and session
    │       └── workspace/      File collection logic
    ├── scripts/                Tests and diagnostics (plain `tsx` scripts)
    ├── tests/fixtures/         Sample PDFs and the test corpus
    ├── docs/                   Tool audit and test-harness notes
    ├── LAYAH_ARCHITECTURE.md   Architecture as implemented
    └── DEVELOPMENT_LOG.md      Decisions, state and open issues
```

## Learn more

- [Architecture](pdf-tool-app/LAYAH_ARCHITECTURE.md): how the engines, editor and workspace fit together
- [Development log](pdf-tool-app/DEVELOPMENT_LOG.md): decisions and open issues
- [Tool audit](pdf-tool-app/docs/TOOL_AUDIT.md): what each tool does and how well it works today
- [Visual-diff harness](pdf-tool-app/docs/VISUAL_DIFF.md): how rendering regressions are checked

## Status

Layah is in active development. The workspace, the standard PDF tools and the object editor work and are covered by automated tests, but the editor has not been through full human acceptance testing. Details are in the development log.
