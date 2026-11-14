import * as fs from "fs";
import * as path from "path";
import { compareAnnotations, inspectAnnotations, type AnnotationDiff, type AnnotationInfo, type AnnotationInspection } from "../../src/lib/pdf/annotations";
import { loadPdfJsNode } from "./pdfjs-node";
import { VisualDiffEngine, FPDF_ANNOT, type PageProbe } from "./visual-diff";

/**
 * A-4.1 fidelity comparison. Extends the A-1.7 regression runner and the A-1.8 visual-diff engine: it snapshots a PDF
 * (text, object counts, size, rotation, annotations, render), then compares before/after page by page, reporting
 * affected pages (the intended change must be observed) separately from unaffected pages (nothing may change).
 *
 * Object counts come from PDFium page objects. They are reliable for text/path/image on generated and ordinary files;
 * they do not see annotation appearance content (that is covered by the render diff with FPDF_ANNOT).
 */

const RENDER_WIDTH = 200;
const MAX_UNAFFECTED_PIXEL_PERCENT = 0.05;

export interface PageSnapshot extends PageProbe {
  /** Non-whitespace characters from PDF.js getTextContent. */
  textChars: number;
  annotations: AnnotationInfo[];
  render: { data: Uint8Array; width: number; height: number };
}

export interface PdfSnapshot {
  pageCount: number;
  pages: PageSnapshot[];
  annotations: AnnotationInspection;
}

const engine = new VisualDiffEngine();
let pdfjsPromise: Promise<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function snapshotPdf(bytes: Uint8Array): Promise<PdfSnapshot> {
  pdfjsPromise ??= loadPdfJsNode();
  const pdfjs = await pdfjsPromise;
  const probes = await engine.probePages(bytes);
  const annotations = await inspectAnnotations(bytes);
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  const pages: PageSnapshot[] = [];
  try {
    for (const probe of probes) {
      const page = await doc.getPage(probe.pageIndex + 1);
      const content = await page.getTextContent();
      const textChars = content.items.reduce((n: number, it: { str?: string }) => n + (it.str ?? "").replace(/\s/g, "").length, 0);
      const h = Math.max(1, Math.round((RENDER_WIDTH * probe.height) / probe.width));
      const render = await engine.renderPageToRgba(bytes, probe.pageIndex, RENDER_WIDTH, h, FPDF_ANNOT);
      pages.push({ ...probe, textChars, annotations: annotations.pages[probe.pageIndex] ?? [], render });
    }
  } finally {
    await task.destroy();
  }
  return { pageCount: pages.length, pages, annotations };
}

// ---------------------------------------------------------------------------------------------------------------------

export interface PageContext {
  before: PageSnapshot;
  after: PageSnapshot;
  /** Differing pixels, or null when the page size changed so the renders are not comparable. */
  pixelsChanged: number | null;
  annotations: AnnotationDiff;
}

/** Returns failure messages; an empty array means the intended change was observed. */
export type PageExpectation = (ctx: PageContext) => string[];

const OBJ_KEYS = ["text", "path", "image", "shading", "form"] as const;

const objectsEqual = (a: PageSnapshot, b: PageSnapshot) => OBJ_KEYS.every((k) => a.objects[k] === b.objects[k]);

/** The page rotation grew by `deg`, and its text and objects are otherwise unchanged. */
export function rotatedBy(deg: number): PageExpectation {
  return ({ before, after }) => {
    const out: string[] = [];
    const want = (((before.rotation + deg) % 360) + 360) % 360;
    if (after.rotation !== want) out.push(`rotation ${before.rotation} -> ${after.rotation}, expected ${want}`);
    if (after.textChars !== before.textChars) out.push(`text ${before.textChars} -> ${after.textChars} characters, expected unchanged`);
    if (!objectsEqual(before, after)) out.push("objects changed, expected unchanged");
    return out;
  };
}

/** At least `min.<type>` objects were added of each named type, and nothing was removed. */
export function addsObjects(min: Partial<Record<(typeof OBJ_KEYS)[number], number>>): PageExpectation {
  return ({ before, after }) => {
    const out: string[] = [];
    for (const k of OBJ_KEYS) {
      const delta = after.objects[k] - before.objects[k];
      if (delta < (min[k] ?? 0)) out.push(`${k} objects ${before.objects[k]} -> ${after.objects[k]}, expected at least +${min[k]}`);
      else if (delta < 0) out.push(`${k} objects were removed (${before.objects[k]} -> ${after.objects[k]})`);
    }
    if (after.textChars < before.textChars) out.push(`text ${before.textChars} -> ${after.textChars} characters, characters were lost`);
    return out;
  };
}

/** Something about the page is different (render, text, objects, size, rotation or annotations). */
export function visiblyChanged(): PageExpectation {
  return (ctx) => (differences(ctx).length || ctx.pixelsChanged === null ? [] : ["no change observed on the affected page"]);
}

function differences(ctx: PageContext): string[] {
  const { before: b, after: a } = ctx;
  const out: string[] = [];
  if (Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01) out.push(`page size ${b.width}x${b.height} -> ${a.width}x${a.height}`);
  if (a.rotation !== b.rotation) out.push(`rotation ${b.rotation} -> ${a.rotation}`);
  if (a.textChars !== b.textChars) out.push(`text ${b.textChars} -> ${a.textChars} characters`);
  if (!objectsEqual(b, a)) out.push(`objects changed (${OBJ_KEYS.filter((k) => a.objects[k] !== b.objects[k]).map((k) => `${k} ${b.objects[k]} -> ${a.objects[k]}`).join(", ")})`);
  if (!ctx.annotations.ok) out.push(...ctx.annotations.messages.map((m) => `annotations: ${m}`));
  if (ctx.pixelsChanged !== null) {
    const total = a.render.width * a.render.height;
    const pct = (ctx.pixelsChanged / total) * 100;
    if (pct > MAX_UNAFFECTED_PIXEL_PERCENT) out.push(`pixel diff ${pct.toFixed(2)}% (${ctx.pixelsChanged} px) exceeds ${MAX_UNAFFECTED_PIXEL_PERCENT}%`);
  }
  return out;
}

export interface FidelitySpec {
  fixture: string;
  operation: string;
  /** Source page indexes (0-based) the operation is meant to change. */
  affectedPages: number[];
  /** pageMap[i] = output index of source page i, or null when the page is removed on purpose. Default identity. */
  pageMap?: (number | null)[];
  /** Output page indexes that are new on purpose (merge, blank page). */
  addedPages?: number[];
  /** Required when affectedPages is not empty: checks that the intended change happened. */
  expectAffected?: PageExpectation;
}

export interface PageResult {
  sourcePage: number;
  destPage: number | null;
  pass: boolean;
  /** Failure explanations (empty when passing). */
  notes: string[];
  metrics: {
    textBefore: number;
    textAfter?: number;
    pathBefore: number;
    pathAfter?: number;
    objectsBefore: number;
    objectsAfter?: number;
    rotationBefore: number;
    rotationAfter?: number;
    pixelsChanged?: number | null;
  };
}

export interface GroupResult {
  /** Source page indexes, 0-based. */
  pages: number[];
  pass: boolean;
  results: PageResult[];
}

export interface FidelityReport {
  fixture: string;
  operation: string;
  pageCountBefore: number;
  pageCountAfter: number;
  expectedPageCount: number;
  affected: GroupResult;
  unaffected: GroupResult;
  /** Page-count and document-level problems. */
  globalFailures: string[];
  /** Everything that failed, ready to print. */
  failures: string[];
  pass: boolean;
}

export function compareSnapshots(before: PdfSnapshot, after: PdfSnapshot, spec: FidelitySpec): FidelityReport {
  if (spec.affectedPages.length && !spec.expectAffected) throw new Error("compareSnapshots: affectedPages needs expectAffected so the intended change is verified");
  const map = spec.pageMap ?? before.pages.map((_, i) => i);
  if (map.length !== before.pageCount) throw new Error(`compareSnapshots: pageMap has ${map.length} entries for ${before.pageCount} pages`);
  const added = spec.addedPages ?? [];
  const expectedPageCount = map.filter((m) => m !== null).length + added.length;

  const globalFailures: string[] = [];
  if (after.pageCount !== expectedPageCount) globalFailures.push(`page count ${before.pageCount} -> ${after.pageCount}, expected ${expectedPageCount}`);
  if (after.annotations.dangling > before.annotations.dangling) globalFailures.push(`dangling annotation references ${before.annotations.dangling} -> ${after.annotations.dangling}`);

  const affectedSet = new Set(spec.affectedPages);
  const affected: GroupResult = { pages: [], pass: true, results: [] };
  const unaffected: GroupResult = { pages: [], pass: true, results: [] };

  before.pages.forEach((b, src) => {
    const dest = map[src];
    if (dest === null) return; // removed on purpose: checked through the page count
    const isAffected = affectedSet.has(src);
    const group = isAffected ? affected : unaffected;
    group.pages.push(src);
    const a = after.pages[dest];
    const metrics: PageResult["metrics"] = { textBefore: b.textChars, pathBefore: b.objects.path, objectsBefore: b.objects.total, rotationBefore: b.rotation };
    const result: PageResult = { sourcePage: src, destPage: dest, pass: true, notes: [], metrics };
    group.results.push(result);
    if (!a) {
      result.pass = false;
      result.notes.push(`page missing from the output (expected at position ${dest + 1})`);
      return;
    }
    Object.assign(metrics, { textAfter: a.textChars, pathAfter: a.objects.path, objectsAfter: a.objects.total, rotationAfter: a.rotation });
    let pixelsChanged: number | null = null;
    if (a.render.width === b.render.width && a.render.height === b.render.height) pixelsChanged = engine.compare(b.render, a.render).differingPixels;
    metrics.pixelsChanged = pixelsChanged;
    const annotations = compareAnnotations(
      { pages: [b.annotations], total: b.annotations.length, byType: {}, dangling: 0 },
      { pages: [a.annotations], total: a.annotations.length, byType: {}, dangling: 0 },
    );
    const ctx: PageContext = { before: b, after: a, pixelsChanged, annotations };
    result.notes = isAffected ? spec.expectAffected!(ctx) : differences(ctx);
    result.pass = result.notes.length === 0;
  });
  affected.pass = affected.results.every((r) => r.pass);
  unaffected.pass = unaffected.results.every((r) => r.pass);

  const failures = [
    ...globalFailures,
    ...affected.results.flatMap((r) => r.notes.map((n) => `affected page ${r.sourcePage + 1}: ${n}`)),
    ...unaffected.results.flatMap((r) => r.notes.map((n) => `unaffected page ${r.sourcePage + 1}: ${n}`)),
  ];
  return {
    fixture: spec.fixture,
    operation: spec.operation,
    pageCountBefore: before.pageCount,
    pageCountAfter: after.pageCount,
    expectedPageCount,
    affected,
    unaffected,
    globalFailures,
    failures,
    pass: !globalFailures.length && affected.pass && unaffected.pass,
  };
}

// ---------------------------------------------------------------------------------------------------------------------

const list = (pages: number[]) => (pages.length ? pages.map((p) => p + 1).join(", ") : "none");

function pageLine(r: PageResult): string {
  const m = r.metrics;
  const nums = `text ${m.textBefore}->${m.textAfter ?? "?"}, objects ${m.objectsBefore}->${m.objectsAfter ?? "?"}, pixels changed ${m.pixelsChanged ?? "n/a"}`;
  return `    ${r.pass ? "PASS" : "FAIL"}  page ${r.sourcePage + 1}${r.destPage !== null && r.destPage !== r.sourcePage ? ` (now ${r.destPage + 1})` : ""}: ${nums}${r.notes.length ? `\n          ${r.notes.join("\n          ")}` : ""}`;
}

/** Readable summary of one comparison. */
export function formatReport(r: FidelityReport): string {
  const lines = [
    `FIDELITY  ${r.pass ? "PASS" : "FAIL"}`,
    `  Fixture:   ${r.fixture}`,
    `  Operation: ${r.operation}`,
    `  Pages:     ${r.pageCountBefore} -> ${r.pageCountAfter} (expected ${r.expectedPageCount})`,
    `  Affected pages: ${list(r.affected.pages)}`,
    ...r.affected.results.map(pageLine),
    `  Affected-page result: ${r.affected.results.length ? (r.affected.pass ? "PASS" : "FAIL") : "n/a (no pages affected)"}`,
    `  Unaffected pages: ${list(r.unaffected.pages)}`,
    ...r.unaffected.results.map(pageLine),
    `  Unaffected-page result: ${r.unaffected.results.length ? (r.unaffected.pass ? "PASS" : "FAIL") : "n/a (no unaffected pages)"}`,
    `  OVERALL: ${r.pass ? "PASS" : "FAIL"}`,
  ];
  if (r.failures.length) lines.push("  Failure explanation:", ...r.failures.map((f) => `    - ${f}`));
  return lines.join("\n");
}

/** Writes fidelity-report.json and fidelity-report.txt to tests/visual-diff-output (gitignored, shared with A-1.8). */
export function writeReports(reports: FidelityReport[], dir = path.resolve(__dirname, "../../tests/visual-diff-output")): string {
  fs.mkdirSync(dir, { recursive: true });
  const slim = reports.map((r) => ({ ...r, affected: { ...r.affected }, unaffected: { ...r.unaffected } }));
  fs.writeFileSync(path.join(dir, "fidelity-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), pass: reports.every((r) => r.pass), reports: slim }, null, 2));
  const txt = reports.map(formatReport).join("\n\n");
  fs.writeFileSync(path.join(dir, "fidelity-report.txt"), txt + "\n");
  return path.join(dir, "fidelity-report.txt");
}
