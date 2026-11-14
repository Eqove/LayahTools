import type { OcrPageStatus } from "../pdf/ocr-overlay";

/**
 * Scanned-PDF detection: which pages have a usable text layer, which are images that need OCR.
 * Classification and status handling are pure; `analyzeTextLayer` measures a real PDF through an injected PDF.js
 * (the browser passes react-pdf's; tests pass the pdfjs-dist legacy build in Node).
 */

export type TextLayerStatus = "TEXT_AVAILABLE" | "SCANNED_PAGE" | "MIXED_CONTENT";
export type PageStatus = TextLayerStatus | OcrPageStatus;
export type OcrMode = "scanned" | "all";

/** What was measured on one page (0-based index). */
export interface PageTextStats {
  pageIndex: number;
  /** Letters and digits in the extractable text (whitespace and punctuation do not count). */
  alnumChars: number;
  /** Share of the page area covered by raster images, 0..1 (overlaps are double counted, then capped). */
  imageCoverage: number;
}

export interface PageAnalysis extends PageTextStats {
  status: TextLayerStatus;
  /** SCANNED_PAGE with no text and (almost) no image: probably an empty page, OCR will likely find nothing. */
  blank: boolean;
}

export interface TextLayerSummary {
  pageCount: number;
  /** True when at least one page has a usable text layer. */
  hasTextLayer: boolean;
  /** TEXT: no page needs OCR. SCANNED: every page does. MIXED: some do. EMPTY: no pages. */
  kind: "TEXT" | "SCANNED" | "MIXED" | "EMPTY";
  /** Pages without meaningful text: the OCR candidates. */
  scannedPages: number[];
  textPages: number[];
  /** Pages with a text layer on top of a full-page image (e.g. an already-recognised scan). OCR is optional there. */
  mixedPages: number[];
  needsOcr: boolean;
  pages: PageAnalysis[];
}

export interface TextLayerOptions {
  /** Letters/digits needed for a page without a full-page image to count as having text. */
  minTextChars: number;
  /** Letters/digits needed when a full-page image covers the page (a page-number stamp must not count). */
  minTextCharsOnImagePage: number;
  /** Image coverage at or above which the page is treated as a full-page image. */
  fullPageImageRatio: number;
  /** Below this coverage, a page with no text is flagged blank. */
  blankImageRatio: number;
}

export const DEFAULT_TEXT_LAYER_OPTIONS: TextLayerOptions = {
  minTextChars: 3,
  minTextCharsOnImagePage: 50,
  fullPageImageRatio: 0.8,
  blankImageRatio: 0.05,
};

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

export function classifyPage(stats: PageTextStats, options: Partial<TextLayerOptions> = {}): PageAnalysis {
  const o = { ...DEFAULT_TEXT_LAYER_OPTIONS, ...options };
  const alnum = num(stats?.alnumChars);
  const cov = Math.min(1, num(stats?.imageCoverage));
  const full = cov >= o.fullPageImageRatio;
  const textful = alnum >= (full ? o.minTextCharsOnImagePage : o.minTextChars);
  return {
    pageIndex: Number.isFinite(stats?.pageIndex) ? stats.pageIndex : 0,
    alnumChars: Math.floor(alnum),
    imageCoverage: Math.round(cov * 1000) / 1000,
    status: !textful ? "SCANNED_PAGE" : full ? "MIXED_CONTENT" : "TEXT_AVAILABLE",
    blank: !textful && alnum === 0 && cov < o.blankImageRatio,
  };
}

export function summarizeTextLayer(stats: PageTextStats[], options: Partial<TextLayerOptions> = {}): TextLayerSummary {
  const list = Array.isArray(stats) ? stats.filter(Boolean) : [];
  const pages = list.map((s) => classifyPage(s, options)).sort((a, b) => a.pageIndex - b.pageIndex);
  const idx = (st: TextLayerStatus) => pages.filter((p) => p.status === st).map((p) => p.pageIndex);
  const scannedPages = idx("SCANNED_PAGE");
  return {
    pageCount: pages.length,
    hasTextLayer: pages.some((p) => p.status !== "SCANNED_PAGE"),
    kind: !pages.length ? "EMPTY" : scannedPages.length === pages.length ? "SCANNED" : scannedPages.length === 0 ? "TEXT" : "MIXED",
    scannedPages,
    textPages: idx("TEXT_AVAILABLE"),
    mixedPages: idx("MIXED_CONTENT"),
    needsOcr: scannedPages.length > 0,
    pages,
  };
}

/** Pages to hand to OCR. `undefined` (no analysis available) means "all pages", the OCR tool's default. */
export function pagesToOcr(summary: TextLayerSummary | null | undefined, mode: OcrMode): number[] | undefined {
  if (!summary) return undefined;
  return mode === "all" ? summary.pages.map((p) => p.pageIndex) : [...summary.scannedPages];
}

export type OcrStatusMap = Record<number, OcrPageStatus>;

export function applyOcrStatus(map: OcrStatusMap, pageIndex: number, status: OcrPageStatus): OcrStatusMap {
  return { ...map, [pageIndex]: status };
}

/** One entry per page: the OCR status when OCR touched the page, otherwise the detected status. */
export function pageStatusView(summary: TextLayerSummary, ocr: OcrStatusMap): { pageIndex: number; status: PageStatus; base: TextLayerStatus; blank: boolean }[] {
  return summary.pages.map((p) => ({ pageIndex: p.pageIndex, status: ocr[p.pageIndex] ?? p.status, base: p.status, blank: p.blank }));
}

export function ocrProgress(ocr: OcrStatusMap, targets: number[]): { total: number; done: number; failed: number; processing: number } {
  let done = 0;
  let failed = 0;
  let processing = 0;
  for (const t of targets) {
    const s = ocr[t];
    if (s === "OCR_COMPLETED" || s === "OCR_FAILED") done++;
    if (s === "OCR_FAILED") failed++;
    if (s === "OCR_PROCESSING") processing++;
  }
  return { total: targets.length, done, failed, processing };
}

// ---------------------------------------------------------------------------------------------------------------
// PDF.js adapter

export interface PdfJsPageLike {
  getTextContent(): Promise<{ items: { str?: string }[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getViewport(params: { scale: number }): { width: number; height: number };
  cleanup?: () => unknown;
}
export interface PdfJsDocLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPageLike>;
}
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; verbosity?: number }): { promise: Promise<PdfJsDocLike>; destroy?: () => unknown };
  OPS: Record<string, number>;
}

export class TextLayerAnalysisError extends Error {
  readonly code: "PASSWORD" | "INVALID" | "FAILED";
  readonly pageIndex?: number;
  constructor(message: string, code: "PASSWORD" | "INVALID" | "FAILED", pageIndex?: number) {
    super(message);
    this.name = "TextLayerAnalysisError";
    this.code = code;
    this.pageIndex = pageIndex;
  }
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const isMatrix = (a: unknown): a is Matrix => Array.isArray(a) && a.length >= 6 && a.slice(0, 6).every((v) => typeof v === "number" && Number.isFinite(v));

// Built from a string so the ES2017 compile target does not reject the \p property escapes; runtime support is universal.
const MEANINGFUL = new RegExp("[\\p{L}\\p{N}]", "gu");

/** Area (points squared) painted by raster images, from the operator list: unit square under the current matrix. */
function imageArea(ops: { fnArray: number[]; argsArray: unknown[] }, OPS: Record<string, number>): number {
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter((n) => typeof n === "number"));
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let area = 0;
  ops.fnArray.forEach((fn, i) => {
    const a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform && isMatrix(a)) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (isMatrix(a)) ctm = mul(ctm, a);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (paint.has(fn)) area += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
  });
  return area;
}

/**
 * Measures every page of a PDF: how much real text it has and how much of it an image covers.
 * `bytes` is copied (PDF.js transfers its input to the worker). Image coverage comes from the page's operator list and
 * is approximate: only plain, inline and mask image paints are counted, overlaps double count, and an image PDF.js
 * decides not to paint (e.g. a fully transparent placeholder) is not seen. That is why text decides the status and
 * coverage only separates MIXED_CONTENT from TEXT_AVAILABLE and flags blank pages.
 */
export async function analyzeTextLayer(
  bytes: Uint8Array,
  pdfjs: PdfJsLike,
  options: Partial<TextLayerOptions> & { onProgress?: (done: number, total: number) => void } = {}
): Promise<TextLayerSummary> {
  if (!bytes || !bytes.byteLength) throw new TextLayerAnalysisError("The file is empty.", "INVALID");
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  try {
    let doc: PdfJsDocLike;
    try {
      doc = await task.promise;
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "PasswordException") throw new TextLayerAnalysisError("This PDF is password protected. Unlock it first.", "PASSWORD");
      if (name === "InvalidPDFException") throw new TextLayerAnalysisError("This file is not a valid PDF or is damaged.", "INVALID");
      throw new TextLayerAnalysisError(`Could not open the PDF: ${e instanceof Error ? e.message : String(e)}`, "INVALID");
    }
    const stats: PageTextStats[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        const page = await doc.getPage(n);
        const text = await page.getTextContent();
        const alnumChars = (text.items.map((t) => t.str ?? "").join("").match(MEANINGFUL) ?? []).length;
        const vp = page.getViewport({ scale: 1 });
        const pageArea = vp.width * vp.height;
        const area = imageArea(await page.getOperatorList(), pdfjs.OPS);
        stats.push({ pageIndex: n - 1, alnumChars, imageCoverage: pageArea > 0 ? Math.min(1, area / pageArea) : 0 });
        page.cleanup?.();
      } catch (e) {
        throw new TextLayerAnalysisError(`Could not read page ${n}: ${e instanceof Error ? e.message : String(e)}`, "FAILED", n - 1);
      }
      options.onProgress?.(n, doc.numPages);
    }
    return summarizeTextLayer(stats, options);
  } finally {
    await task.destroy?.();
  }
}
