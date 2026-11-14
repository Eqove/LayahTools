/**
 * Schema (version 1) for the labeled expected outputs in tests/fixtures/pdf-corpus/expected/.
 * Coordinates are PDF space: points, origin bottom-left (same as src/lib/document).
 * Test-only; nothing in src/ depends on it.
 */
export interface Box {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** Column zone of a region on the page; reading order must run full -> left -> right. */
export type Zone = "full" | "left" | "right";

export interface ExpectedTextRegion {
  id: string;
  role: "title" | "author" | "heading" | "paragraph" | "caption" | "list" | "code" | "footnote" | "reference-list" | "label";
  zone: Zone;
  /** Measured union of the text lines inside the region (stroke-free, glyph-tight PDFium bounds). */
  bounds: Box;
  /** Start of the region text as PDFium extracts it (whitespace-normalised). */
  textStart: string;
  /** End of the region text as PDFium extracts it (whitespace-normalised). */
  textEnd: string;
  /** Region whose text this one continues (sentence runs across a column or page break). */
  continuesFrom?: string;
}

export interface ExpectedFigure {
  id: string;
  zone: Zone;
  /** Union of the vector path objects inside `pathWindow`. */
  bounds: Box;
  pathWindow: Box;
  /** Text objects inside the figure (e.g. keycap labels) belong to the figure, not to a text region. */
  containsText: boolean;
}

export interface ExpectedTable {
  id: string;
  zone: Zone;
  /** Union of the ruling lines (stroke-inclusive). */
  bounds: Box;
  rows: number;
  columns: number;
  /** Horizontal rule centre lines, top to bottom. */
  rowEdgesY: number[];
  /** Vertical rule centre lines, left to right. */
  colEdgesX: number[];
  /** Cells spanning several columns (separating rule absent in that row). */
  merged: { row: number; colStart: number; colEnd: number }[];
  /** Row-major cell text, whitespace-normalised. A merged cell appears once, in its first column; the rest are "". */
  cells: string[][];
}

export interface ExpectedFormField {
  name: string;
  type: "text";
  /** Widget rectangle as stored in the PDF (/Rect), PDF space. */
  bounds: Box;
  value: string;
  /** Text region holding the visible label for this field. */
  labelRegionId: string;
}

export interface ExpectedList {
  id: string;
  type: "bullet" | "numbered" | "alpha" | "roman";
  items: string[];
}

export interface ExpectedPage {
  pageIndex: number;
  width: number;
  height: number;
  textRegions: ExpectedTextRegion[];
  figures?: ExpectedFigure[];
  tables?: ExpectedTable[];
  formFields?: ExpectedFormField[];
  lists?: ExpectedList[];
  /** Region/figure/table/field ids in expected reading order; a permutation of everything on the page. */
  readingOrder: string[];
}

export interface Uncertainty {
  id: string;
  what: string;
  why: string;
}

export interface ExpectedOutput {
  schemaVersion: 1;
  fixture: string;
  sha256: string;
  pageCount: number;
  /** Max allowed difference (points) per kind of measurement. */
  tolerance: { textBounds: number; vector: number; formRect: number };
  provenance: { structure: string; geometry: string; text: string };
  pages: ExpectedPage[];
  /** Headers/footers/page numbers expected from detectRepeatedElements (A-3.1). [] = verified none. */
  repeatedElements?: { kind: "HEADER" | "FOOTER" | "PAGE_NUMBER"; text: string; pageIndexes: number[] }[];
  uncertain: Uncertainty[];
  limitations: string[];
}

/** Normalises extracted text for comparison: control characters (soft hyphens come out as U+0002) become spaces, runs collapse. */
export const normText = (s: string): string =>
  s
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
