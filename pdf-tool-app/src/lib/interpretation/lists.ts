import { Bounds, PageText, TextItem, round2, unionBounds } from "./types";
import { groupIntoLines, TextLine } from "./text-lines";

export type ListType = "bullet" | "numbered" | "alpha" | "roman";

export interface ListItem {
  /** Item text without the marker; wrapped lines are joined with a single space. */
  text: string;
  /** The marker as written, e.g. "•", "2.", "(c)", "iv.". */
  marker: string;
  /** 0-based position in reading order, nested items included. */
  order: number;
  /** 0 = top level, 1 = first nested level, ... */
  level: number;
  /** Type of this item's own marker (nested lists may differ from the list's type). */
  markerType: ListType;
  /** Ordinal value (1-based) for numbered/alpha/roman markers. */
  value?: number;
  bounds: Bounds;
  /** Number of text lines (1 + wrapped lines). */
  lineCount: number;
}

export interface DetectedList {
  /** Type of the top-level markers. */
  type: ListType;
  items: ListItem[];
  bounds: Bounds;
  /** 0..1 heuristic. Lower for weak markers (-, *), missing numbers, odd start values, few items, ragged indent. */
  confidence: number;
  /** Top-level ordinal values skipped between consecutive items (e.g. [3] for 1,2,4). */
  missingValues?: number[];
  /** Set by detectListsInPages. */
  pageIndex?: number;
}

export interface ListOptions {
  /** Max marker x difference (points) for two markers to share an indent level. */
  indentTolerance: number;
  /** A wrapped line may start this far left of the item's text start. */
  wrapIndentTolerance: number;
  /** Max vertical gap between list lines, as a multiple of line height, before a new list starts. */
  maxItemGapRatio: number;
  /** Max vertical gap, as a multiple of line height, for a line to count as a wrapped continuation. */
  wrapGapRatio: number;
  /** A marker may sit at most this far (points) right of the previous item's marker and still belong to the list. */
  maxNestIndent: number;
  /** Passed to line grouping (column split gap). */
  lineGap?: number;
}

export const DEFAULT_LIST_OPTIONS: ListOptions = {
  indentTolerance: 8,
  wrapIndentTolerance: 10,
  maxItemGapRatio: 2.5,
  wrapGapRatio: 1,
  maxNestIndent: 72,
};

const MAX_WRAP_INDENT = 36;

type Ordinal = Exclude<ListType, "bullet">;
interface Cand {
  type: Ordinal;
  value: number;
  upper?: boolean;
}
interface ParsedMarker {
  marker: string;
  rest: string;
  bullet: boolean;
  weak: boolean;
  cands: Cand[];
}

const ROMAN_VAL: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
const ROMAN_TABLE: [string, number][] = [["c", 100], ["xc", 90], ["l", 50], ["xl", 40], ["x", 10], ["ix", 9], ["v", 5], ["iv", 4], ["i", 1]];
function toRoman(n: number): string {
  let r = "";
  for (const [s, v] of ROMAN_TABLE) {
    while (n >= v) {
      r += s;
      n -= v;
    }
  }
  return r;
}
function parseRoman(s: string): number | null {
  const t = s.toLowerCase();
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN_VAL[t[i]];
    if (!v) return null;
    total += i + 1 < t.length && v < ROMAN_VAL[t[i + 1]] ? -v : v;
  }
  return total > 0 && toRoman(total) === t ? total : null;
}

const STRICT_BULLET = /^([•◦▪▫‣●○■□·-])\s*(\S.*)$/;
const WEAK_BULLET = /^([*\-–—])\s+(\S.*)$/;
const NUMBERED = /^(?:(\d{1,3})([.)])|\((\d{1,3})\))\s+(\S.*)$/;
const LETTERS = /^(?:([A-Za-z]|[ivxlc]{2,6}|[IVXLC]{2,6})([.)])|\(([A-Za-z]|[ivxlc]{2,6}|[IVXLC]{2,6})\))\s+(\S.*)$/;

function parseMarker(text: string): ParsedMarker | null {
  let m = STRICT_BULLET.exec(text);
  if (m) return { marker: m[1], rest: m[2], bullet: true, weak: false, cands: [] };
  m = WEAK_BULLET.exec(text);
  if (m) return { marker: m[1], rest: m[2], bullet: true, weak: true, cands: [] };
  m = NUMBERED.exec(text);
  if (m) {
    const n = parseInt(m[1] ?? m[3], 10);
    return { marker: m[1] !== undefined ? m[1] + m[2] : `(${m[3]})`, rest: m[4], bullet: false, weak: false, cands: [{ type: "numbered", value: n }] };
  }
  m = LETTERS.exec(text);
  if (m) {
    const tok = m[1] ?? m[3];
    const cands: Cand[] = [];
    const upper = tok === tok.toUpperCase();
    if (tok.length === 1) cands.push({ type: "alpha", value: tok.toLowerCase().charCodeAt(0) - 96, upper });
    const r = parseRoman(tok);
    if (r !== null && (tok === tok.toLowerCase() || upper)) cands.push({ type: "roman", value: r, upper });
    if (!cands.length) return null;
    return { marker: m[1] !== undefined ? m[1] + m[2] : `(${m[3]})`, rest: m[4], bullet: false, weak: false, cands };
  }
  return null;
}

interface Work {
  pm: ParsedMarker;
  text: string;
  level: number;
  group: Group;
  markerLeft: number;
  textLeft: number;
  bounds: Bounds;
  lineCount: number;
}
interface Group {
  x: number;
  types: Set<ListType>;
  last: Partial<Record<ListType, number>>;
  upper?: boolean;
  items: Work[];
}
interface OpenList {
  groups: Group[]; // active chain, index = level
  allGroups: Group[];
  items: Work[];
  base: number;
  right: number;
  lastBottom: number;
  last: Work;
  closed: boolean;
}

const valueOf = (w: Work, t: ListType) => w.pm.cands.find((c) => c.type === t)?.value;

function newGroup(w: Work): Group {
  const g: Group = { x: w.markerLeft, types: new Set(), last: {}, items: [] };
  if (w.pm.bullet) g.types.add("bullet");
  for (const c of w.pm.cands) {
    g.types.add(c.type);
    g.last[c.type] = c.value;
    g.upper = c.upper;
  }
  return g;
}

/** Which of the group's types can the next marker continue? null = it cannot continue this group. */
function matchTypes(g: Group, pm: ParsedMarker): Set<ListType> | null {
  if (pm.bullet) return g.types.has("bullet") ? new Set<ListType>(["bullet"]) : null;
  const out = new Set<ListType>();
  for (const c of pm.cands) {
    const last = g.last[c.type];
    if (g.types.has(c.type) && last !== undefined && c.value > last && (c.type === "numbered" || c.upper === g.upper)) out.add(c.type);
  }
  return out.size ? out : null;
}

function missingCount(g: Group, t: ListType): number {
  const v = g.items.map((w) => valueOf(w, t) ?? 0);
  let n = 0;
  for (let i = 1; i < v.length; i++) n += Math.max(0, v[i] - v[i - 1] - 1);
  return n;
}

function resolveType(g: Group): ListType {
  if (g.types.has("bullet")) return "bullet";
  const t = [...g.types];
  if (t.length === 1) return t[0];
  // ambiguous letters (alpha vs roman): fewest skipped values wins; a lone "i" leans roman
  const a = missingCount(g, "alpha");
  const r = missingCount(g, "roman");
  if (a !== r) return r < a ? "roman" : "alpha";
  return valueOf(g.items[0], "roman") === 1 ? "roman" : "alpha";
}

/**
 * Detects bullet / numbered / alphabetical / roman lists (with nesting) in the text of one page.
 * Pure and deterministic. Lists never span pages here; use detectListsInPages for a whole document.
 * Known limits: "[1]" citations and "1.1" section numbers are not markers; a wrapped line flush with the marker
 * (not with the text) ends the list; lists split across columns or pages are not stitched together.
 */
export function detectLists(items: TextItem[], options: Partial<ListOptions> = {}): DetectedList[] {
  if (!Array.isArray(items)) return [];
  const o = { ...DEFAULT_LIST_OPTIONS, ...options };
  const lines = groupIntoLines(items, { maxGap: o.lineGap });
  const lists: OpenList[] = [];
  const hOf = (l: TextLine) => Math.max(1, l.bounds.top - l.bounds.bottom);

  const toWork = (l: TextLine, pm: ParsedMarker, level: number, group: Group): Work => {
    const first = l.items[0];
    const cw = (first.bounds.right - first.bounds.left) / Math.max(1, first.text.length);
    const textLeft = l.items.length > 1 && first.text === pm.marker ? l.items[1].bounds.left : first.bounds.left + (pm.marker.length + 1) * cw;
    return { pm, text: pm.rest, level, group, markerLeft: l.bounds.left, textLeft, bounds: { ...l.bounds }, lineCount: 1 };
  };
  const attach = (O: OpenList, w: Work, l: TextLine) => {
    O.items.push(w);
    w.group.items.push(w);
    O.last = w;
    O.lastBottom = l.bounds.bottom;
    O.right = Math.max(O.right, l.bounds.right);
  };
  const startList = (l: TextLine, pm: ParsedMarker) => {
    const w = toWork(l, pm, 0, undefined as unknown as Group);
    const g = newGroup(w);
    w.group = g;
    const O: OpenList = { groups: [g], allGroups: [g], items: [], base: l.bounds.left, right: l.bounds.right, lastBottom: l.bounds.bottom, last: w, closed: false };
    attach(O, w, l);
    lists.push(O);
  };

  for (const l of lines) {
    const h = hOf(l);
    const pm = parseMarker(l.text);

    if (pm) {
      let target: OpenList | undefined;
      let bestGap = Infinity;
      for (const O of lists) {
        if (O.closed) continue;
        const gap = O.lastBottom - l.bounds.top;
        if (gap > o.maxItemGapRatio * h) continue;
        if (l.bounds.left < O.base - o.indentTolerance) continue;
        if (l.bounds.left - O.last.markerLeft > o.maxNestIndent) continue;
        if (gap < bestGap) {
          bestGap = gap;
          target = O;
        }
      }
      if (!target) {
        startList(l, pm);
        continue;
      }
      const O = target;
      const x = l.bounds.left;
      let k = -1;
      let kd = Infinity;
      O.groups.forEach((g, i) => {
        const d = Math.abs(x - g.x);
        if (d <= o.indentTolerance && d < kd) {
          kd = d;
          k = i;
        }
      });
      if (k < 0) {
        if (x > O.groups[O.groups.length - 1].x + o.indentTolerance) k = O.groups.length;
        else O.groups.forEach((g, i) => { if (Math.abs(x - g.x) < kd) { kd = Math.abs(x - g.x); k = i; } });
      }
      const existing = O.groups[k];
      const matched = existing ? matchTypes(existing, pm) : null;
      if (existing && !matched && k === 0) {
        O.closed = true; // type change / numbering restart at the top level = a new list
        startList(l, pm);
        continue;
      }
      O.groups.length = Math.min(k, O.groups.length); // drop deeper groups (and the stale one on mismatch)
      let g: Group;
      if (existing && matched) {
        g = existing;
        g.types = matched;
        for (const c of pm.cands) if (matched.has(c.type)) g.last[c.type] = c.value;
      } else {
        g = newGroup(toWork(l, pm, k, undefined as unknown as Group));
        O.allGroups.push(g);
      }
      O.groups.push(g);
      attach(O, toWork(l, pm, k, g), l);
      continue;
    }

    // not a marker line: wrapped continuation of the last item, or the end of any list it sits under
    let wrapTo: OpenList | undefined;
    let wrapGap = Infinity;
    for (const O of lists) {
      if (O.closed) continue;
      const gap = O.lastBottom - l.bounds.top;
      if (gap > o.wrapGapRatio * h || gap < -0.5 * h) continue;
      if (l.bounds.left < O.last.textLeft - o.wrapIndentTolerance || l.bounds.left > O.last.textLeft + MAX_WRAP_INDENT) continue;
      if (gap < wrapGap) {
        wrapGap = gap;
        wrapTo = O;
      }
    }
    if (wrapTo) {
      const w = wrapTo.last;
      w.text += " " + l.text;
      w.bounds = unionBounds([w.bounds, l.bounds]);
      w.lineCount++;
      wrapTo.lastBottom = Math.min(wrapTo.lastBottom, l.bounds.bottom);
      wrapTo.right = Math.max(wrapTo.right, l.bounds.right);
      continue;
    }
    for (const O of lists) {
      if (O.closed) continue;
      const extent = Math.max(O.right, O.last.markerLeft + o.maxNestIndent);
      if (l.bounds.left <= extent && l.bounds.right >= O.base - o.indentTolerance) O.closed = true;
    }
  }

  const out: DetectedList[] = [];
  for (const O of lists) {
    if (O.items.length < 2 || !O.allGroups.some((g) => g.items.length >= 2)) continue;
    const resolved = new Map<Group, ListType>(O.allGroups.map((g) => [g, resolveType(g)]));
    const top = O.allGroups[0];
    const type = resolved.get(top)!;
    const listItems: ListItem[] = O.items.map((w, i) => {
      const t = resolved.get(w.group)!;
      const v = t === "bullet" ? undefined : valueOf(w, t);
      return { text: w.text, marker: w.pm.marker, order: i, level: w.level, markerType: t, ...(v !== undefined ? { value: v } : {}), bounds: w.bounds, lineCount: w.lineCount };
    });

    // confidence
    let missing: number[] | undefined;
    let c = type === "bullet" ? (top.items.every((w) => w.pm.weak) ? 0.65 : 0.9) : type === "numbered" ? 0.9 : 0.75;
    const n = top.items.length;
    c *= n >= 4 ? 1 : n === 3 ? 0.95 : n === 2 ? 0.85 : 0.6;
    if (type !== "bullet") {
      const vals = top.items.map((w) => valueOf(w, type) ?? 0);
      if (vals[0] !== 1) c *= type === "numbered" ? 0.85 : 0.8;
      missing = [];
      for (let i = 1; i < vals.length; i++) for (let v = vals[i - 1] + 1; v < vals[i]; v++) missing.push(v);
      c *= Math.max(0.5, 1 - 0.12 * missing.length);
    }
    const dev = Math.max(0, ...top.items.map((w) => Math.abs(w.markerLeft - top.x)));
    c *= 1 - 0.1 * Math.min(1, dev / o.indentTolerance);

    out.push({
      type,
      items: listItems,
      bounds: unionBounds(O.items.map((w) => w.bounds)),
      confidence: Math.max(0.05, Math.min(0.99, round2(c))),
      ...(missing ? { missingValues: missing } : {}),
    });
  }
  return out.sort((a, b) => b.bounds.top - a.bounds.top || a.bounds.left - b.bounds.left);
}

/** Runs detectLists on every page; results are tagged with pageIndex and ordered by page. */
export function detectListsInPages(pages: PageText[], options: Partial<ListOptions> = {}): DetectedList[] {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((p) => p && Number.isFinite(p.pageIndex))
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .flatMap((p) => detectLists(p.items, options).map((l) => ({ ...l, pageIndex: p.pageIndex })));
}
