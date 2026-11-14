import { PDFDocument, rgb } from "pdf-lib";

/**
 * Pure (pdf-lib only) half of the OCR tool: takes recognised words and writes them as an invisible text layer.
 * The recogniser (Tesseract + PDF.js rendering) is injected, so this runs and is tested in Node; the browser half
 * lives in heavy-operations.ts (`ocrPdf`). The source bytes are never modified: a new document is returned.
 */

export type OcrPageStatus = "OCR_PROCESSING" | "OCR_COMPLETED" | "OCR_FAILED";

/** A recognised word; bbox is in image pixels, top-left origin (Tesseract convention). */
export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrRecognition {
  words: OcrWord[];
  /** Size in pixels of the image the words were recognised on (used to scale back to PDF points). */
  imageWidth: number;
  imageHeight: number;
}

/** Recognises one page (0-based index). May throw; the failure is reported for that page. */
export type OcrRecognizer = (pageIndex: number) => Promise<OcrRecognition>;

export interface OcrPageReport {
  pageIndex: number;
  status: "OCR_COMPLETED" | "OCR_FAILED";
  /** Words written to the page. 0 with OCR_COMPLETED means the page was processed but nothing was recognised. */
  words: number;
  /** Words that could not be written (characters the standard font cannot encode, malformed boxes). */
  skippedWords: number;
  error?: string;
}

export interface OcrOverlayOptions {
  /** 0-based pages to process. Default: all pages. Duplicates are ignored; pages are processed in order. */
  pages?: number[];
  onPageStatus?: (pageIndex: number, status: OcrPageStatus, report?: OcrPageReport) => void;
}

export class OcrError extends Error {
  readonly reports: OcrPageReport[];
  constructor(message: string, reports: OcrPageReport[] = []) {
    super(message);
    this.name = "OcrError";
    this.reports = reports;
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Writes an invisible text layer for the selected pages of `source` and returns the new PDF bytes plus a per-page report.
 * Throws OcrError when the document cannot be opened, the selection is invalid, or every selected page fails.
 * Rotated pages are refused (the word boxes would be placed against the wrong axes).
 */
export async function overlayOcrText(
  source: Uint8Array | ArrayBuffer,
  recognize: OcrRecognizer,
  options: OcrOverlayOptions = {}
): Promise<{ bytes: Uint8Array; reports: OcrPageReport[] }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source);
  } catch (e) {
    throw new OcrError(`Could not open the PDF for OCR: ${msg(e)}`);
  }
  const pageCount = doc.getPageCount();

  let targets: number[];
  if (options.pages === undefined) targets = Array.from({ length: pageCount }, (_, i) => i);
  else {
    if (!options.pages.length) throw new OcrError("No pages selected for OCR.");
    for (const p of options.pages) {
      if (!Number.isInteger(p) || p < 0 || p >= pageCount) {
        throw new OcrError(`Page ${Number.isInteger(p) ? p + 1 : String(p)} is outside this document (pages 1-${pageCount}).`);
      }
    }
    targets = [...new Set(options.pages)].sort((a, b) => a - b);
  }
  if (!targets.length) throw new OcrError("No pages selected for OCR.");

  const reports: OcrPageReport[] = [];
  const finish = (r: OcrPageReport) => {
    reports.push(r);
    options.onPageStatus?.(r.pageIndex, r.status, r);
  };
  const fail = (pageIndex: number, error: string) => finish({ pageIndex, status: "OCR_FAILED", words: 0, skippedWords: 0, error });

  for (const i of targets) {
    options.onPageStatus?.(i, "OCR_PROCESSING");
    const page = doc.getPage(i);
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    if (rotation !== 0) {
      fail(i, `Page ${i + 1} is rotated ${rotation}°; OCR text placement on rotated pages is not supported yet.`);
      continue;
    }
    try {
      const rec = await recognize(i);
      if (!(rec.imageWidth > 0) || !(rec.imageHeight > 0)) throw new Error("the page image has no size");
      const { width, height } = page.getSize();
      const sx = width / rec.imageWidth;
      const sy = height / rec.imageHeight;
      let written = 0;
      let skipped = 0;
      for (const w of rec.words) {
        if (!w || typeof w.text !== "string" || !w.text.trim()) continue;
        const b = w.bbox;
        if (!b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) {
          skipped++;
          continue;
        }
        const x = Math.min(b.x0, b.x1) * sx;
        const yTop = Math.max(b.y0, b.y1); // image y grows downward
        const h = Math.abs(b.y1 - b.y0) * sy;
        try {
          // invisible text over the scan: makes the page searchable and selectable without changing how it looks
          page.drawText(w.text, { x, y: height - yTop * sy, size: Math.max(h * 0.9, 1), color: rgb(0, 0, 0), opacity: 0 });
          written++;
        } catch {
          skipped++; // e.g. characters outside the standard font's encoding
        }
      }
      finish({ pageIndex: i, status: "OCR_COMPLETED", words: written, skippedWords: skipped });
    } catch (e) {
      fail(i, `Page ${i + 1}: ${msg(e)}`);
    }
  }

  if (reports.every((r) => r.status === "OCR_FAILED")) {
    throw new OcrError(`OCR failed on all ${reports.length} page(s): ${reports[0].error ?? "unknown error"}`, reports);
  }
  return { bytes: await doc.save(), reports };
}
