# Phase 0: Layah Foundation

This plan outlines the foundational architectural changes required to transition the existing FlashPDF project into the first iteration of **Layah**, aligning with the core principle: *One Execution Engine. Multiple Interfaces.*

## Goal Description

Transition the monolithic FlashPDF codebase into a modular, workflow-ready architecture. We will establish the core Tool Registry, convert isolated PDF operations into chainable workflow steps, move processing off the main thread using Web Workers, and implement a scalable UI foundation (Tailwind CSS + shadcn/ui) without losing any existing functionality.

## User Review Required

> [!IMPORTANT]  
> **Styling Migration:** This plan proposes migrating from raw CSS Modules to **Tailwind CSS** and **shadcn/ui** (headless Radix components). This is the fastest, most reliable way for a bootstrapped startup to achieve the "polished and trustworthy" UX required for Layah. Please confirm you are comfortable with introducing Tailwind.

> [!IMPORTANT]  
> **Workflow vs Direct Tools:** In this initial phase, the UI will still *look* like individual direct tools to preserve the current UX. However, under the hood, every action will be executed as a "single-step workflow" through the new Execution Engine. This sets the stage for multi-step workflows in the next phase without breaking what currently works.

## Proposed Changes

### Core Architecture (The Execution Engine)

To support multi-step workflows without re-uploading, operations must be chainable. Currently, operations take a `File` and return a final byte array. We will refactor them to take a loaded `PDFDocument` (from `pdf-lib`) and mutate it or return a new `PDFDocument`.

#### [NEW] `src/lib/layah/registry.ts`
- Define the `ToolRegistry` schema (Tool ID, Name, Accepted Inputs, Configuration Requirements).
- Migrate metadata from `tool-config.ts` into formal Tool Definitions.

#### [NEW] `src/lib/layah/engine.ts`
- Build the `ExecutionEngine`. 
- Takes a `StructuredWorkflow` (an array of steps with tool IDs and configurations).
- Executes steps sequentially on the document buffer.

#### [MODIFY] `src/lib/pdf/operations.ts`
- Refactor all 8 existing functions (`mergePdfFiles`, `splitPdfByRanges`, etc.) to conform to the new `ToolProcessingFunction` signature (e.g., `(doc: PDFDocument, config: ToolConfig) => Promise<PDFDocument>`).

### Performance (Web Workers)

Processing large PDFs currently freezes the browser. We will move the Layah Execution Engine into a Web Worker.

#### [NEW] `src/lib/worker/pdf.worker.ts`
- A Web Worker script that instantiates the `ExecutionEngine`.
- Listens for messages containing the workflow plan and file buffers, processes them, and posts the resulting buffers back to the main thread.

#### [NEW] `src/lib/worker/use-pdf-worker.ts`
- A React hook to easily communicate with the Web Worker from the UI components.

### User Interface Modularity & Polish

The monolithic `pdf-studio.tsx` file (500+ lines) will be broken down and restyled.

#### [NEW] `tailwind.config.ts`, `postcss.config.js`, `components.json`
- Initialize Tailwind CSS and shadcn/ui configuration.

#### [DELETE] `src/app/page.module.css`, `src/components/pdf-studio.module.css`
- Remove legacy CSS modules in favor of utility classes.

#### [MODIFY] `src/components/pdf-studio.tsx`
- Refactor into a simpler layout shell.

#### [NEW] `src/components/workspace/`
- `tool-sidebar.tsx`: The left navigation for selecting tools.
- `dropzone.tsx`: A reusable file upload component.
- `tool-config-panel.tsx`: A dynamic form renderer that reads the `ToolRegistry` to display the correct inputs for the active tool.
- `results-panel.tsx`: Displays execution output and download links.

## Verification Plan

### Automated Tests
- Run `npm run lint` and `npm run build` to ensure the new modular architecture compiles successfully.

### Manual Verification
- Test all 8 existing tools (Merge, Split, Extract, Delete, Rotate, Watermark, Page Numbers, Blank) via the UI.
- Verify that large files (e.g., 20MB+) no longer freeze the browser UI during processing (confirming the Web Worker functions correctly).
- Verify the UI looks polished, responsive, and trustworthy with the new design system.
