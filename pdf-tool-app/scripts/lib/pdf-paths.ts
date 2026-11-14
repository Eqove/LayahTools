import * as fs from "fs";
import { init } from "@embedpdf/pdfium";
import type { Bounds } from "../../src/lib/interpretation/types";

export interface PathObject {
  pageIndex: number;
  bounds: Bounds;
  width: number;
  height: number;
}

/**
 * Test-only: lists vector path objects (PDFium object type 2) per page with their bounds.
 * Uses raw PDFium separately from PdfEditorEngine, which only exposes text and image objects.
 * Path bounds include the stroke width.
 */
export async function loadPathObjects(bytes: Uint8Array): Promise<PathObject[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfium: any = await init({ wasmBinary: fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm") });
  const wasm = pdfium.pdfium || pdfium;
  pdfium.PDFiumExt_Init();
  const ptr = wasm._malloc(bytes.length);
  wasm.HEAPU8.set(bytes, ptr);
  const doc = pdfium.FPDF_LoadMemDocument(ptr, bytes.length, "");
  if (!doc) {
    wasm._free(ptr);
    throw new Error("PDFium could not load the document");
  }
  const out: PathObject[] = [];
  const f = wasm._malloc(16);
  try {
    const pages = pdfium.FPDF_GetPageCount(doc);
    for (let p = 0; p < pages; p++) {
      const page = pdfium.FPDF_LoadPage(doc, p);
      const n = pdfium.FPDFPage_CountObjects(page);
      for (let i = 0; i < n; i++) {
        const obj = pdfium.FPDFPage_GetObject(page, i);
        if (pdfium.FPDFPageObj_GetType(obj) !== 2) continue;
        pdfium.FPDFPageObj_GetBounds(obj, f, f + 4, f + 8, f + 12);
        const b = { left: wasm.getValue(f, "float"), bottom: wasm.getValue(f + 4, "float"), right: wasm.getValue(f + 8, "float"), top: wasm.getValue(f + 12, "float") };
        out.push({ pageIndex: p, bounds: b, width: b.right - b.left, height: b.top - b.bottom });
      }
      pdfium.FPDF_ClosePage(page);
    }
  } finally {
    wasm._free(f);
    pdfium.FPDF_CloseDocument(doc);
    wasm._free(ptr);
  }
  return out;
}

export interface RuledTable {
  /** Union of the ruling lines (stroke-inclusive). */
  bounds: Bounds;
  /** Horizontal rule centre lines, top to bottom (PDF y, descending). */
  rowEdgesY: number[];
  /** Vertical rule centre lines, left to right. */
  colEdgesX: number[];
  /** Cells spanning several columns because the separating rule is absent in that row. */
  merged: { row: number; colStart: number; colEnd: number }[];
}

const within = (b: Bounds, w: Bounds, tol = 0.5) => b.left >= w.left - tol && b.right <= w.right + tol && b.bottom >= w.bottom - tol && b.top <= w.top + tol;
const dedupe = (v: number[], tol = 0.5) => v.sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > tol);

/**
 * Test-only: reads a ruled table from vector path objects inside `window`.
 * Horizontal rules are thin paths spanning (almost) the whole window width; vertical rules are thin paths at least half
 * the window height. Shorter thin paths (hyperlink underlines) are ignored. Returns null if no grid is found.
 */
export function tableFromRules(paths: PathObject[], window: Bounds, maxThickness = 2.5): RuledTable | null {
  const inside = paths.filter((p) => within(p.bounds, window));
  const W = window.right - window.left;
  const H = window.top - window.bottom;
  const hRules = inside.filter((p) => p.height <= maxThickness && p.width >= 0.95 * W);
  const vRules = inside.filter((p) => p.width <= maxThickness && p.height >= 0.5 * H);
  if (hRules.length < 2 || vRules.length < 2) return null;
  const rowEdgesY = dedupe(hRules.map((p) => (p.bounds.bottom + p.bounds.top) / 2)).reverse();
  const colEdgesX = dedupe(vRules.map((p) => (p.bounds.left + p.bounds.right) / 2));
  const merged: RuledTable["merged"] = [];
  for (let r = 0; r + 1 < rowEdgesY.length; r++) {
    const yTop = rowEdgesY[r];
    const yBot = rowEdgesY[r + 1];
    const sep = colEdgesX.map((x) => vRules.some((p) => Math.abs((p.bounds.left + p.bounds.right) / 2 - x) <= 0.5 && p.bounds.bottom <= yBot + 1 && p.bounds.top >= yTop - 1));
    let start = 0;
    for (let c = 1; c < colEdgesX.length; c++) {
      // column c-1 ends at edge c; the cell continues when the rule at edge c is missing in this row
      if (sep[c] || c === colEdgesX.length - 1) {
        if (c - 1 > start) merged.push({ row: r, colStart: start, colEnd: c - 1 });
        start = c;
      }
    }
  }
  const all = [...hRules, ...vRules].map((p) => p.bounds);
  return {
    bounds: { left: Math.min(...all.map((b) => b.left)), bottom: Math.min(...all.map((b) => b.bottom)), right: Math.max(...all.map((b) => b.right)), top: Math.max(...all.map((b) => b.top)) },
    rowEdgesY,
    colEdgesX,
    merged,
  };
}
