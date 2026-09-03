# Project Overview

The project is a Next.js web application named "FlashPDF V1 Build". It is designed as a fast, browser-first tool for performing quick PDF operations (merging, splitting, rotating, etc.) without requiring a backend for file processing. It appears to have been intended as a lightweight, privacy-focused PDF utility that can be extended into a more comprehensive suite of tools.

# Repository Structure

- `src/app/`: Contains the Next.js App Router entry points (`page.tsx`, `layout.tsx`) and global styles.
- `src/components/`: Contains the main user interface component, `pdf-studio.tsx`, which acts as the workspace shell, file dropper, and tool selector.
- `src/lib/pdf/`: Contains the core PDF business logic.
  - `operations.ts`: The actual PDF manipulation functions using `pdf-lib`.
  - `ranges.ts`: Utility for parsing user input like "1, 3-5" into page arrays.
  - `tool-config.ts`: Configuration array defining the available tools and their metadata.
  - `types.ts`: TypeScript definitions for the tools.

# Technology Stack

- **Framework**: Next.js 16 (App Router)
- **UI Library**: React 19
- **PDF Processing**: `pdf-lib` (Client-side PDF manipulation)
- **Styling**: CSS Modules (No Tailwind or external component libraries currently)
- **Language**: TypeScript

# Existing Features

| Feature Name | Status | Relevant Files | How it Works |
| --- | --- | --- | --- |
| **Merge PDF** | Working | `operations.ts` (`mergePdfFiles`) | Appends pages from multiple PDF buffers into a new PDFDocument. |
| **Split PDF** | Working | `operations.ts` (`splitPdfByRanges`) | Creates multiple new documents from defined page ranges. |
| **Extract Pages** | Working | `operations.ts` (`extractPdfPages`) | Copies specific pages into a new document. |
| **Delete Pages** | Working | `operations.ts` (`deletePdfPages`) | Removes specific pages from the source document. |
| **Rotate PDF** | Working | `operations.ts` (`rotatePdf`) | Applies a rotation transformation to every page. |
| **Add Watermark** | Working | `operations.ts` (`watermarkPdf`) | Draws angled, semi-transparent text on every page. |
| **Page Numbers** | Working | `operations.ts` (`addPageNumbers`) | Draws page numbers at the bottom right of every page. |
| **Create Blank PDF**| Working | `operations.ts` (`createBlankPdf`) | Generates a new PDF with standard fonts and basic text layout. |

*Note: All current features are processed 100% in the browser. There are no placeholder or broken features in the current codebase.*

# Current User Flow

1. User lands on the homepage which renders the `PdfStudio` component.
2. User selects a tool from the left sidebar.
3. User drops one or more PDF files into the dropzone.
4. User configures tool-specific settings (e.g., page ranges, rotation angle).
5. User clicks the action button.
6. The application processes the PDF entirely in the browser main thread.
7. The result appears in a "Results" pane with a direct download button.

# Architecture

The application uses a **Client-Side Processing Architecture**. 
Even though it is built on Next.js, all PDF manipulation happens in the browser using the `pdf-lib` library. The UI state is managed in a single monolithic React component (`PdfStudio`), which dynamically renders configuration fields based on the selected tool. When an operation is executed, the file buffers are passed to isolated functions in `operations.ts`, which return new byte arrays for download.

# What Works

- The entire core loop (Upload -> Configure -> Process -> Download).
- All 8 integrated PDF tools perform their operations correctly.
- Client-side file parsing and byte generation.

# What Is Incomplete

- **Visual Feedback**: There are no live page previews. Users cannot see what the PDF looks like before or after processing without downloading it.
- **Advanced Tools**: Features mentioned in the UI (Text editing, signatures, form filling) do not exist yet.
- **UI Extensibility**: The `pdf-studio.tsx` file is becoming a bottleneck (500 lines) and manually handles every tool's form fields.

# What Is Broken or Risky

- **Main Thread Blocking**: PDF processing currently happens on the main UI thread. For very large PDFs, this will freeze the browser.
- **Limited Error Handling**: Malformed PDFs or extreme edge cases (like encrypted PDFs) might cause generic errors.

# Technical Debt

- **Monolithic Component**: `PdfStudio` and its child `ToolFields` function should be split into smaller, modular components (e.g., a generic Form builder based on the tool config).
- **Styling**: CSS Modules are fine for V1, but migrating to a utility-first framework (Tailwind) and a robust component library (Radix UI / shadcn) will drastically speed up building a "polished and trustworthy user experience."

# Privacy and Security Findings

- **Excellent Privacy**: Files never leave the user's device. There is no backend upload, no temporary server storage, and no database.
- **Security Risks**: Client-side execution limits traditional server-side risks. The main risk is client-side memory exhaustion (crashing the tab) if a user uploads a massive file.

# Web and Mobile Recommendations

To support both Web and Mobile while minimizing duplicate logic:

1. **Architecture Model**: Adopt a Monorepo (e.g., using Turborepo).
2. **Shared Core**: Move `src/lib/pdf/*` into a shared package (e.g., `@flashpdf/core`). Because the logic uses `pdf-lib` (pure JavaScript/TypeScript), it can run identically in Node.js, Web Browsers, and React Native.
3. **Web Platform**: Continue using Next.js (React) for the web version, importing the shared core.
4. **Mobile Platform**: Build the mobile app using **React Native (Expo)**. You can reuse the exact same PDF processing logic locally on the mobile device. This avoids building API endpoints just for mobile, keeping mobile operations fast and private.
5. **Worker Offloading**: Implement Web Workers for the Web version (and Background Threads for React Native) to process large PDFs without freezing the UI.

# Monetization Opportunities

Since the mobile version must be **free of advertisements**, and we want to preserve a trustworthy UX:

- **Freemium Web Model**: 
  - Free: Basic tools (Merge, Split, etc.) with usage limits (e.g., max 20MB file size, or 3 operations per hour).
  - Premium Subscription: Unlimited file sizes, batch processing (100+ files), and access to pro tools (OCR, Digital Signatures, Redaction).
- **Mobile Model**:
  - Completely ad-free.
  - Core features remain free. 
  - Cross-platform subscription unlocks the same Premium tools on mobile.
  - Offer one-time in-app purchases for specific "Pro Tool Packs" if subscriptions are not desired.
- **API / B2B Access**: If we eventually build server-side equivalents (for heavy tasks like OCR), we can offer a paid API for developers.

# Recommended Development Roadmap

- **Phase 0: Architecture Refactoring & Polish**
  - Break down `pdf-studio.tsx` into modular components.
  - Implement a modern UI system (Tailwind + shadcn/ui) for a trustworthy, polished look.
  - Move PDF processing to a Web Worker to prevent UI freezing.
- **Phase 1: Visual Experience (The "Trust" Factor)**
  - Implement live PDF previews (using `pdf.js` to render canvas previews) so users see exactly what they are manipulating.
  - Implement drag-and-drop page reordering.
- **Phase 2: Premium Feature Foundation**
  - Add text editing and form-filling capabilities.
  - Handle encrypted/password-protected PDFs.
- **Phase 3: Cross-Platform Expansion**
  - Extract core logic into a shared package.
  - Build the React Native (Expo) mobile application using the shared core.
- **Phase 4: Monetization Integration**
  - Implement authentication (e.g., Clerk or Supabase).
  - Implement Stripe for premium subscriptions and usage limit tracking.

# Immediate Next Steps

1. **Review this document** to align on the current state and proposed vision.
2. **Approve Phase 0**: Let me refactor `pdf-studio.tsx` into smaller, manageable components and implement Web Workers for background processing to stabilize the foundation before we add complex features.
3. **Decide on Styling**: Confirm if we should migrate from raw CSS Modules to Tailwind CSS and a component library to achieve the "polished" requirement efficiently.
