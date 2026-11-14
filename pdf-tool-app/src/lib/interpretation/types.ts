import type { LayahObjectBounds } from "../document/types";

/** PDF space: bottom-left origin, points. Same shape as the Layah model's bounds (type-only import). */
export type Bounds = LayahObjectBounds;

/** One extracted text object. Engine-independent: built from PDFium/Layah objects or PDF.js items. */
export interface TextItem {
  text: string;
  bounds: Bounds;
}

export interface PageText {
  /** 0-based page index. */
  pageIndex: number;
  /** Page size in points. Pages without a finite positive size are ignored by position-based detectors. */
  width: number;
  height: number;
  items: TextItem[];
}

export const isFiniteBounds = (b: unknown): b is Bounds => {
  const o = b as Bounds | null | undefined;
  return !!o && [o.left, o.bottom, o.right, o.top].every((n) => typeof n === "number" && Number.isFinite(n));
};

/** Returns bounds with left<=right and bottom<=top. */
export const normalizeBounds = (b: Bounds): Bounds => ({
  left: Math.min(b.left, b.right),
  right: Math.max(b.left, b.right),
  bottom: Math.min(b.bottom, b.top),
  top: Math.max(b.bottom, b.top),
});

export const unionBounds = (list: Bounds[]): Bounds => ({
  left: Math.min(...list.map((b) => b.left)),
  bottom: Math.min(...list.map((b) => b.bottom)),
  right: Math.max(...list.map((b) => b.right)),
  top: Math.max(...list.map((b) => b.top)),
});

export const round2 = (n: number) => Math.round(n * 100) / 100;
