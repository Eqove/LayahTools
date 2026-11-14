import { Bounds, TextItem, isFiniteBounds, normalizeBounds, unionBounds } from "./types";

export interface TextLine {
  text: string;
  bounds: Bounds;
  items: TextItem[];
}

export interface LineGroupingOptions {
  /** Max baseline-center difference (points) to share a line. Default: half the smaller item height, at least 1.5. */
  yTolerance?: number;
  /** Horizontal gap (points) above which one baseline is split into separate segments (columns). Default max(24, 3 x line height). */
  maxGap?: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Groups loose text items into visual line segments, top-to-bottom then left-to-right.
 * Invalid items (non-string text, empty text, non-finite bounds) are skipped. Pure and deterministic.
 */
export function groupIntoLines(items: TextItem[], options: LineGroupingOptions = {}): TextLine[] {
  if (!Array.isArray(items)) return [];
  const clean: TextItem[] = [];
  for (const it of items) {
    if (!it || typeof it.text !== "string" || !it.text.trim() || !isFiniteBounds(it.bounds)) continue;
    clean.push({ text: it.text.replace(/\s+/g, " ").trim(), bounds: normalizeBounds(it.bounds) });
  }
  const cy = (b: Bounds) => (b.bottom + b.top) / 2;
  clean.sort((a, b) => cy(b.bounds) - cy(a.bounds) || a.bounds.left - b.bounds.left || cmp(a.text, b.text));

  const rows: { anchor: number; height: number; items: TextItem[] }[] = [];
  for (const it of clean) {
    const h = it.bounds.top - it.bounds.bottom;
    const row = rows.find(
      (r) => Math.abs(r.anchor - cy(it.bounds)) <= (options.yTolerance ?? Math.max(1.5, 0.5 * Math.min(h, r.height)))
    );
    if (row) {
      row.items.push(it);
      row.height = Math.max(row.height, h);
    } else rows.push({ anchor: cy(it.bounds), height: h, items: [it] });
  }

  const out: TextLine[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.bounds.left - b.bounds.left || cmp(a.text, b.text));
    const maxGap = options.maxGap ?? Math.max(24, 3 * row.height);
    let seg: TextItem[] = [];
    const flush = () => {
      if (!seg.length) return;
      let text = seg[0].text;
      for (let i = 1; i < seg.length; i++) {
        const gap = seg[i].bounds.left - seg[i - 1].bounds.right;
        text += (gap <= 0.1 * row.height ? "" : " ") + seg[i].text;
      }
      out.push({ text, bounds: unionBounds(seg.map((s) => s.bounds)), items: seg });
      seg = [];
    };
    for (const it of row.items) {
      if (seg.length && it.bounds.left - seg[seg.length - 1].bounds.right > maxGap) flush();
      seg.push(it);
    }
    flush();
  }
  return out;
}
