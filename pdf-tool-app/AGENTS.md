# LayahTools — Agent Rules & Engineering Guidelines (Alpha Lane)

## Project Identity
LayahTools is a browser-first document workspace focused on PDF processing and document intelligence.

Architecture principle:
"One Execution Engine. Multiple Interfaces."

## Technology Stack
- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- PDF.js / react-pdf for rendering and text extraction
- @embedpdf/pdfium WASM for native PDF object editing
- pdf-lib for PDF page operations, creation and forms
- Tesseract.js for OCR

## Engineering Rules
1. AI must never directly mutate PDF bytes. Deterministic processing engines perform document modifications.
2. Never claim that a feature works unless it has been tested.
3. Preserve the original uploaded document.
4. Validate exported PDFs by reopening them.
5. Visual cover is not secure redaction.
6. Unfinished tools must display "Coming soon" or remain hidden.
7. The FILES collection and active document are separate concepts.
8. Uploading a file must append it to the collection, never replace the collection.
9. PDF coordinates use bottom-left origin (Y increases upward).
10. Viewport coordinates use top-left origin (Y increases downward).
11. Selection must never trigger document export or reload.

## Alpha Ownership
Alpha owns:
- FILES panel and workspace file module.
- Standalone PDF tools.
- PDF testing corpus and regression infrastructure.
- CI configuration.
- Loading, error and empty states.
- Header/footer and list detectors.
- Capability registration.
- Confirmation and change-summary UI.
- AI provider abstraction.
- Instrumentation and cross-browser testing.

## Strictly Protected Beta Modules
Do not modify these modules without explicit approval:
- `PdfEditorEngine`
- `EditorSession` internals
- Layah document model and mapper (`src/lib/document/*`)
- `EditorController`
- `PdfViewer` overlay logic

If an Alpha task requires changes to these modules, document the requirement and request Beta's involvement.

## Coding Standards
- Follow existing repository conventions.
- Reuse existing components and utilities.
- Avoid unnecessary dependencies.
- Avoid unnecessary refactoring.
- Prefer small, testable functions.
- Write unit tests for pure functions.
- Handle loading, error and empty states.
- Keep UI consistent with the existing LayahTools design system.
- Geist Sans for UI.
- Instrument Serif for headings.
- Prefer borders over shadows.
- Use restrained border radii.

## Quality Requirements
Before completing a task:
- Run relevant tests (`npm test`).
- Run the production build (`npm run build`).
- Verify the actual UI behavior.
- Test exported PDFs by reopening them where applicable.
- Document known limitations.

Lint only the files modified by Alpha. Do not attempt to fix unrelated legacy lint errors.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
