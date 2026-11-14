import { Bounds, PageText, isFiniteBounds, round2, unionBounds } from "./types";
import { groupIntoLines } from "./text-lines";

export type RepeatedKind = "HEADER" | "FOOTER" | "PAGE_NUMBER";

export interface RepeatedOccurrence {
  pageIndex: number;
  text: string;
  bounds: Bounds;
}

export interface RepeatedElement {
  /** Raw text of the first occurrence. */
  text: string;
  kind: RepeatedKind;
  /** 0-based indexes of the pages where the element was found, ascending. */
  pageIndexes: number[];
  /** PAGE_NUMBER only: the parsed number on each page (same order as pageIndexes). */
  values?: number[];
  /** Union of all occurrences. */
  bounds: Bounds;
  occurrences: RepeatedOccurrence[];
  /** 0..1. Heuristic: page coverage + positional consistency (+ numbering consistency for page numbers). */
  confidence: number;
}

export interface RepeatedElementOptions {
  /** Fraction of the page height at the top/bottom that counts as the header/footer zone. */
  bandRatio: number;
  /** Horizontal tolerance (points); a left, centre or right edge may match. */
  positionTolerance: number;
  /** Vertical tolerance (points) between line centres. */
  verticalTolerance: number;
  /** Minimum pages an element must appear on. */
  minPages: number;
  /** An element must cover this share of all pages... */
  minCoverage: number;
  /** ...or form a run of this many consecutive pages (a section header). */
  minSectionRun: number;
  /** Passed to line grouping (column split gap). */
  lineGap?: number;
}

export const DEFAULT_REPEATED_OPTIONS: RepeatedElementOptions = {
  bandRatio: 0.12,
  positionTolerance: 12,
  verticalTolerance: 6,
  minPages: 2,
  minCoverage: 0.5,
  minSectionRun: 3,
};

type Band = "top" | "bottom";
type Numeral = "arabic" | "roman";

interface Seg {
  pageIndex: number;
  text: string;
  bounds: Bounds;
  band: Band;
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
const ROMAN_TABLE: [string, number][] = [["c", 100], ["xc", 90], ["l", 50], ["xl", 40], ["x", 10], ["ix", 9], ["v", 5], ["iv", 4], ["i", 1]];

function toRoman(n: number): string {
  let r = "";
  for (const [sym, val] of ROMAN_TABLE) {
    while (n >= val) {
      r += sym;
      n -= val;
    }
  }
  return r;
}

function parseRoman(s: string): number | null {
  const t = s.toLowerCase();
  if (!/^[ivxlc]+$/.test(t)) return null;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN[t[i]];
    total += i + 1 < t.length && v < ROMAN[t[i + 1]] ? -v : v;
  }
  // reject non-canonical forms ("iiii", "vx", ...)
  return total > 0 && toRoman(total) === t ? total : null;
}

const OF = "(?:\\s*(?:of|\\/)\\s*\\d{1,5})?";
const PAGE_KW = "(?:page|pg\\.?|p\\.)";
const RE_ARABIC = [
  new RegExp(`^${PAGE_KW}\\s*(\\d{1,5})${OF}$`, "i"),
  new RegExp(`^(\\d{1,5})${OF}$`),
  /^[-–—]\s*(\d{1,5})\s*[-–—]$/,
];
const RE_ROMAN = new RegExp(`^(?:${PAGE_KW}\\s*)?([ivxlc]{1,6})$`, "i");

function parsePageNumber(text: string): { value: number; numeral: Numeral } | null {
  const t = text.trim();
  for (const re of RE_ARABIC) {
    const m = re.exec(t);
    if (m) return { value: parseInt(m[1], 10), numeral: "arabic" };
  }
  const m = RE_ROMAN.exec(t);
  if (m) {
    const v = parseRoman(m[1]);
    if (v !== null) return { value: v, numeral: "roman" };
  }
  return null;
}

/** Key for "same text": case/space-insensitive; an embedded "Page n [of m]" token is masked so "Acme | Page 3" repeats. */
const textKey = (t: string) =>
  t.toLowerCase().replace(/\s+/g, " ").trim().replace(new RegExp(`\\b${PAGE_KW}\\s*\\d{1,5}${OF}`, "gi"), "page #");

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const cyOf = (b: Bounds) => (b.bottom + b.top) / 2;
/** Smallest horizontal offset between two boxes over left / centre / right edges. */
const hDev = (a: Bounds, b: Bounds) =>
  Math.min(Math.abs(a.left - b.left), Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2), Math.abs(a.right - b.right));

/** Cluster segments by position (greedy, input order); at most one member per page. */
function clusterByPosition(segs: Seg[], o: RepeatedElementOptions): Seg[][] {
  const clusters: Seg[][] = [];
  for (const s of segs) {
    const c = clusters.find(
      (cl) =>
        !cl.some((m) => m.pageIndex === s.pageIndex) &&
        hDev(cl[0].bounds, s.bounds) <= o.positionTolerance &&
        Math.abs(cyOf(cl[0].bounds) - cyOf(s.bounds)) <= o.verticalTolerance
    );
    if (c) c.push(s);
    else clusters.push([s]);
  }
  return clusters;
}

function longestRun(pageIdx: number[]): number {
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const p of pageIdx) {
    run = p === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = p;
  }
  return best;
}

/**
 * Detects running headers, footers and page numbers from per-page text objects.
 * Pure: no engine access, input is not mutated, output order is deterministic.
 * Only text inside the top/bottom band is considered, so repeated body text is never classified.
 * Known limit: a single page cannot be "repeated", so single-page documents return [].
 */
export function detectRepeatedElements(pages: PageText[], options: Partial<RepeatedElementOptions> = {}): RepeatedElement[] {
  if (!Array.isArray(pages)) return [];
  const o = { ...DEFAULT_REPEATED_OPTIONS, ...options };
  const valid = pages
    .filter((p) => p && Number.isFinite(p.pageIndex) && Number.isFinite(p.width) && Number.isFinite(p.height) && p.width > 0 && p.height > 0)
    .sort((a, b) => a.pageIndex - b.pageIndex);
  const total = valid.length;
  if (total < o.minPages) return [];

  // 1. line segments inside the header/footer bands
  const segs: Seg[] = [];
  for (const p of valid) {
    for (const l of groupIntoLines(p.items, { maxGap: o.lineGap })) {
      if (!isFiniteBounds(l.bounds)) continue;
      const cy = cyOf(l.bounds);
      const band: Band | null = cy >= p.height * (1 - o.bandRatio) ? "top" : cy <= p.height * o.bandRatio ? "bottom" : null;
      if (band) segs.push({ pageIndex: p.pageIndex, text: l.text, bounds: l.bounds, band });
    }
  }

  const qualifies = (pageIdx: number[]) =>
    pageIdx.length >= o.minPages && (pageIdx.length / total >= o.minCoverage || longestRun(pageIdx) >= o.minSectionRun);
  const posScore = (cl: Seg[]) => {
    const ref = cl[0].bounds;
    let dev = 0;
    for (const m of cl) {
      dev = Math.max(dev, hDev(ref, m.bounds) / o.positionTolerance, Math.abs(cyOf(ref) - cyOf(m.bounds)) / o.verticalTolerance);
    }
    return clamp01(1 - 0.5 * dev);
  };
  const covScore = (n: number) => (n / total >= o.minCoverage ? n / total : 0.7);

  const build = (cl: Seg[], kind: RepeatedKind, conf: number, values?: number[]): RepeatedElement => ({
    text: cl[0].text,
    kind,
    pageIndexes: cl.map((m) => m.pageIndex),
    ...(values ? { values } : {}),
    bounds: unionBounds(cl.map((m) => m.bounds)),
    occurrences: cl.map((m) => ({ pageIndex: m.pageIndex, text: m.text, bounds: { ...m.bounds } })),
    confidence: Math.min(0.99, round2(conf)),
  });

  const result: RepeatedElement[] = [];
  const claimed = new Set<Seg>();

  // 2. page numbers: pattern + position cluster + strictly increasing values
  for (const band of ["top", "bottom"] as Band[]) {
    for (const numeral of ["arabic", "roman"] as Numeral[]) {
      const cand = segs
        .filter((s) => s.band === band)
        .map((s) => ({ s, pn: parsePageNumber(s.text) }))
        .filter((c) => c.pn && c.pn.numeral === numeral);
      const values = new Map<Seg, number>(cand.map((c) => [c.s, c.pn!.value]));
      for (const cl of clusterByPosition(cand.map((c) => c.s), o)) {
        if (!qualifies(cl.map((m) => m.pageIndex))) continue;
        const vals = cl.map((m) => values.get(m)!);
        if (!vals.every((v, i) => i === 0 || v > vals[i - 1])) continue;
        let tracked = 0;
        for (let i = 1; i < cl.length; i++) if (vals[i] - vals[i - 1] === cl[i].pageIndex - cl[i - 1].pageIndex) tracked++;
        const seq = cl.length > 1 ? tracked / (cl.length - 1) : 0;
        result.push(build(cl, "PAGE_NUMBER", 0.4 * covScore(cl.length) + 0.3 * posScore(cl) + 0.3 * seq, vals));
        cl.forEach((m) => claimed.add(m));
      }
    }
  }

  // 3. headers / footers: identical normalised text + aligned position
  const groups = new Map<string, Seg[]>();
  for (const s of segs) {
    if (claimed.has(s)) continue;
    const k = `${s.band}|${textKey(s.text)}`;
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  for (const [, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const cl of clusterByPosition(g, o)) {
      if (!qualifies(cl.map((m) => m.pageIndex))) continue;
      result.push(build(cl, cl[0].band === "top" ? "HEADER" : "FOOTER", 0.6 * covScore(cl.length) + 0.4 * posScore(cl)));
    }
  }

  const order: Record<RepeatedKind, number> = { HEADER: 0, FOOTER: 1, PAGE_NUMBER: 2 };
  return result.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      a.pageIndexes[0] - b.pageIndexes[0] ||
      b.bounds.top - a.bounds.top ||
      a.bounds.left - b.bounds.left ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)
  );
}
