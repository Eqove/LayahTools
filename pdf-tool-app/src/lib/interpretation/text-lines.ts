import { Bounds, TextItem, isFiniteBounds, normalizeBounds, unionBounds } from "./types";

export interface TextLine {
  text: string;
  bounds: Bounds;
  items: TextItem[];
}

export interface LineGroupingOptions {
  /**
   * Horizontal gap (points) above which two items on one baseline are NOT joined (columns, tab stops).
   * Default: max(14, 1.5 x item height). Real two-column pages have gutters of ~18pt, so keep it below that.
   */
  maxGap?: number;
  /** Minimum vertical overlap, as a share of the smaller item's height, for two items to share a line. Default 0.5. */
  minOverlapRatio?: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Groups loose text items into visual line segments, top-to-bottom then left-to-right.
 *
 * Two items belong to the same segment when they overlap vertically (so a glyph-tight "." or a superscript still
 * joins its line) and sit within `maxGap` horizontally; segments are the connected components of that relation.
 * Unlike anchoring on a row centre, baseline offsets between neighbouring columns cannot merge different lines.
 * Invalid items (non-string text, empty text, non-finite bounds) are skipped. Pure and deterministic.
 */
export function groupIntoLines(items: TextItem[], options: LineGroupingOptions = {}): TextLine[] {
  if (!Array.isArray(items)) return [];
  const minOverlap = options.minOverlapRatio ?? 0.5;
  const clean: TextItem[] = [];
  for (const it of items) {
    if (!it || typeof it.text !== "string" || !it.text.trim() || !isFiniteBounds(it.bounds)) continue;
    clean.push({ text: it.text.replace(/\s+/g, " ").trim(), bounds: normalizeBounds(it.bounds) });
  }
  clean.sort((a, b) => a.bounds.left - b.bounds.left || b.bounds.top - a.bounds.top || cmp(a.text, b.text));
  const n = clean.length;
  const h = (i: number) => clean[i].bounds.top - clean[i].bounds.bottom;
  const bound = options.maxGap ?? Math.max(14, 1.5 * Math.max(0, ...clean.map((_, i) => h(i))));

  const parent = clean.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    const a = clean[i].bounds;
    for (let j = i + 1; j < n; j++) {
      const b = clean[j].bounds;
      const gap = b.left - a.right;
      if (gap > bound) break; // sorted by left, so every later item is at least this far away
      if (gap > (options.maxGap ?? Math.max(14, 1.5 * Math.max(h(i), h(j))))) continue;
      const overlap = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
      if (overlap >= minOverlap * Math.max(Math.min(h(i), h(j)), 0.5)) parent[find(j)] = find(i);
    }
  }

  const comps = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const c = comps.get(r);
    if (c) c.push(i);
    else comps.set(r, [i]);
  }

  const out: TextLine[] = [];
  for (const idx of comps.values()) {
    const its = idx.map((i) => clean[i]); // already left-sorted
    const lineH = Math.max(...its.map((t) => t.bounds.top - t.bounds.bottom));
    let text = its[0].text;
    for (let k = 1; k < its.length; k++) {
      const gap = its[k].bounds.left - its[k - 1].bounds.right;
      text += (gap <= 0.1 * lineH ? "" : " ") + its[k].text;
    }
    out.push({ text, bounds: unionBounds(its.map((t) => t.bounds)), items: its });
  }
  const cy = (l: TextLine) => (l.bounds.bottom + l.bounds.top) / 2;
  return out.sort((a, b) => cy(b) - cy(a) || a.bounds.left - b.bounds.left || cmp(a.text, b.text));
}
