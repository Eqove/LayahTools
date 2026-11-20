import type { PdfToolId } from "@/lib/pdf/types";

/**
 * Per-tool wording for the workspace header and options panel.
 * run: the main button. heading: the options section title. inline: on phones, the tool's single setting (or its
 * one-line hint) sits under the header instead of in the Files & options sheet.
 */
export const TOOL_COPY: Record<PdfToolId, { run: string; heading: string; inline: boolean }> = {
  merge: { run: "Merge PDFs", heading: "File order", inline: true },
  split: { run: "Split PDF", heading: "Which pages", inline: true },
  extract: { run: "Extract pages", heading: "Which pages", inline: true },
  delete: { run: "Delete pages", heading: "Which pages", inline: true },
  rotate: { run: "Rotate pages", heading: "Rotation", inline: true },
  watermark: { run: "Add watermark", heading: "Watermark text", inline: true },
  "page-numbers": { run: "Add page numbers", heading: "Page numbers", inline: true },
  blank: { run: "Create PDF", heading: "New page", inline: false },
  rearrange: { run: "Save new order", heading: "Page order", inline: true },
  redact: { run: "Apply redactions", heading: "Redaction", inline: true },
  sign: { run: "Save signed PDF", heading: "Signature", inline: false },
  compress: { run: "Compress PDF", heading: "Compression", inline: true },
  ocr: { run: "Make searchable", heading: "OCR settings", inline: false },
  "pdf-to-image": { run: "Convert to images", heading: "Image format", inline: true },
  "extract-text": { run: "Extract text", heading: "Text output", inline: true },
  "analyze-structure": { run: "Analyze", heading: "Structure output", inline: true },
  "extract-tables": { run: "Find tables", heading: "Table output", inline: true },
  crop: { run: "Crop pages", heading: "Margins", inline: false },
  metadata: { run: "Show properties", heading: "Properties", inline: false },
  "fill-form": { run: "Save filled form", heading: "Form fields", inline: false },
  flatten: { run: "Flatten form", heading: "Flatten", inline: false },
  edit: { run: "Save", heading: "Edit", inline: false },
};
