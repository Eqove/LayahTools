import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { compareAnnotations, inspectAnnotations, type AnnotationInfo, type AnnotationInspection } from "../src/lib/pdf/annotations";
import { addPageNumbers, cropPdf, deletePdfPages, extractPdfPages, mergePdfFiles, rearrangePdf, redactPdf, rotatePdf, signPdf, splitPdfByRanges, watermarkPdf } from "../src/lib/pdf/operations";
import { deleteSinglePage, extractSinglePage, rotateSinglePage } from "../src/lib/pdf/page-actions";
import { compressPdf } from "../src/lib/pdf/heavy-operations";
import { unlockEncryptedPdf } from "../src/lib/pdf/password";
import { fillForm, flattenForm } from "../src/lib/pdf/forms";
import { overlayOcrText } from "../src/lib/pdf/ocr-overlay";
import { EditorSession } from "../src/lib/pdf/editor/session";

/**
 * A-4.4: operations x annotation-type preservation matrix. Every operation is run for real on two fixtures
 * (annotations-markup.pdf, annotations-matrix.pdf) and each source annotation is classified in the output:
 *   PASS    present with every compared property equal and structure intact (or removed on purpose)
 *   PARTIAL present, but structure is degraded (page link, link target, form interactivity) or the op leaves it exposed
 *   FAIL    lost or a compared property changed unexpectedly
 * KNOWN pins every measured non-PASS cell. A new non-PASS cell, or a pinned cell that changes, fails this test.
 * `--print` writes the full table as markdown to tests/visual-diff-output/annotation-matrix.md.
 */
const CORPUS = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const read = (n: string) => new Uint8Array(fs.readFileSync(path.join(CORPUS, n)));
const file = (b: Uint8Array, n = "x.pdf") => new File([b as BlobPart], n, { type: "application/pdf" });
const bytesOf = async (f: File) => new Uint8Array(await f.arrayBuffer());
const wasm = () => new Uint8Array(fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm")).buffer as ArrayBuffer;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Fixture = { name: string; pages: number; fill: Record<string, string> };
const FIXTURES: Fixture[] = [
  { name: "annotations-markup.pdf", pages: 2, fill: { "reviewer.name": "Changed Name" } },
  { name: "annotations-matrix.pdf", pages: 3, fill: { "matrix.field": "Changed Name" } },
];

interface Out {
  bytes: Uint8Array;
  /** pageMap[i] = output page of source page i, null when removed on purpose. Default identity. */
  pageMap?: (number | null)[];
  /** Ignore output pages beyond this count (merge appends a second copy). */
  keepPages?: number;
}
interface Op {
  id: string;
  expected: string;
  run(bytes: Uint8Array, fx: Fixture): Promise<Out>;
  /** Widgets are removed on purpose. */
  removesWidgets?: boolean;
  /** Widget appearance is regenerated on purpose. */
  regeneratesWidgetAppearance?: boolean;
  /** Extra per-annotation exposure note; non-null downgrades PASS to PARTIAL. */
  exposed?(a: AnnotationInfo): string | null;
}

const withoutPage = (n: number, drop: number) => Array.from({ length: n }, (_, i) => (i === drop ? null : i < drop ? i : i - 1));
const onlyPage = (n: number, keep: number) => Array.from({ length: n }, (_, i) => (i === keep ? 0 : null));
const blankPdf = async () => {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return new Uint8Array(await d.save());
};

const OPS: Op[] = [
  { id: "load + save (pdf-lib)", expected: "Dictionaries unchanged", run: async (b) => ({ bytes: new Uint8Array(await (await PDFDocument.load(b)).save()) }) },
  { id: "merge (2 copies)", expected: "First copy keeps annotations, links and form", run: async (b, fx) => ({ bytes: (await mergePdfFiles([file(b), file(b)]))[0].bytes, keepPages: fx.pages }) },
  { id: "insert pages (merge with a blank page)", expected: "Source annotations unchanged when a page is appended", run: async (b, fx) => ({ bytes: (await mergePdfFiles([file(b), file(await blankPdf())]))[0].bytes, keepPages: fx.pages }) },
  { id: "split (full range)", expected: "Annotations copied with their pages", run: async (b, fx) => ({ bytes: (await splitPdfByRanges(file(b), `1-${fx.pages}`))[0].bytes }) },
  { id: "extract pages (all)", expected: "Annotations copied with their pages", run: async (b, fx) => ({ bytes: (await extractPdfPages(file(b), `1-${fx.pages}`))[0].bytes }) },
  { id: "extract page 2 only", expected: "Annotations of page 2 kept; others leave with their pages", run: async (b, fx) => ({ bytes: (await extractPdfPages(file(b), "2"))[0].bytes, pageMap: onlyPage(fx.pages, 1) }) },
  { id: "extract single page 1 (page-actions)", expected: "Annotations of page 1 kept; others leave with their pages", run: async (b, fx) => ({ bytes: await bytesOf(await extractSinglePage(file(b), 0)), pageMap: onlyPage(fx.pages, 0) }) },
  { id: "delete page 1 (multi)", expected: "Annotations of page 1 removed; others kept", run: async (b, fx) => ({ bytes: (await deletePdfPages(file(b), "1"))[0].bytes, pageMap: withoutPage(fx.pages, 0) }) },
  { id: "delete page 1 (single, page-actions)", expected: "Annotations of page 1 removed; others kept", run: async (b, fx) => ({ bytes: await bytesOf(await deleteSinglePage(file(b), 0)), pageMap: withoutPage(fx.pages, 0) }) },
  {
    id: "rearrange (reverse)",
    expected: "Annotations follow their page",
    run: async (b, fx) => {
      const order = Array.from({ length: fx.pages }, (_, i) => fx.pages - 1 - i);
      return { bytes: (await rearrangePdf(file(b), order))[0].bytes, pageMap: order.map((_, i) => fx.pages - 1 - i) };
    },
  },
  { id: "rotate all pages 90", expected: "Annotation dictionaries unchanged (page /Rotate changes)", run: async (b) => ({ bytes: (await rotatePdf(file(b), 90))[0].bytes }) },
  { id: "rotate single page 1", expected: "Annotation dictionaries unchanged", run: async (b) => ({ bytes: await bytesOf(await rotateSinglePage(file(b), 0, 90)) }) },
  { id: "watermark", expected: "Annotations unchanged", run: async (b) => ({ bytes: (await watermarkPdf(file(b), "DRAFT"))[0].bytes }) },
  { id: "page numbers", expected: "Annotations unchanged", run: async (b) => ({ bytes: (await addPageNumbers(file(b), ""))[0].bytes }) },
  { id: "crop (20 pt margins)", expected: "Annotation dictionaries unchanged (position not re-checked against the new page box)", run: async (b) => ({ bytes: (await cropPdf(file(b), { top: 20, right: 20, bottom: 20, left: 20 }))[0].bytes }) },
  {
    id: "redact (box over top of page 1)",
    expected: "Annotations unchanged; content under the box is NOT removed",
    run: async (b) => ({ bytes: (await redactPdf(file(b), [{ pageIndex: 0, x: 0.05, y: 0.05, width: 0.9, height: 0.3 }]))[0].bytes }),
    exposed: (a) => (a.pageIndex === 0 && a.rect && a.rect[1] > 842 * 0.65 && (a.contents || a.hasAppearance) ? "annotation lies under the redaction box and its contents/appearance are still in the file" : null),
  },
  { id: "sign (draw image)", expected: "Annotations unchanged", run: async (b) => ({ bytes: (await signPdf(file(b), [{ pageIndex: 0, dataUrl: PNG, x: 0.6, y: 0.9, width: 0.2, height: 0.05 }]))[0].bytes }) },
  { id: "compress (structural)", expected: "Annotations copied with their pages", run: async (b) => ({ bytes: (await compressPdf(file(b), "recommended"))[0].bytes }) },
  { id: "unlock (copy pages)", expected: "Annotations copied with their pages", run: async (b) => ({ bytes: await bytesOf(await unlockEncryptedPdf(file(b), "")) }) },
  { id: "OCR text overlay", expected: "Annotations unchanged", run: async (b) => ({ bytes: (await overlayOcrText(b, async () => ({ words: [], imageWidth: 100, imageHeight: 100 }))).bytes }) },
  { id: "fill form", expected: "Widget value changes; all other annotations unchanged", regeneratesWidgetAppearance: true, run: async (b, fx) => ({ bytes: (await fillForm(b, fx.fill)).bytes }) },
  { id: "flatten form", expected: "Widgets removed on purpose; all other annotations unchanged", removesWidgets: true, run: async (b) => ({ bytes: (await flattenForm(b)).bytes }) },
  {
    id: "editor edit (PDFium export)",
    expected: "Annotations unchanged after an edit and export",
    run: async (b) => {
      const s = new EditorSession();
      await s.open(b, wasm());
      await s.addRect(0, { x: 400, y: 100, width: 50, height: 20, fill: [255, 0, 0] });
      return { bytes: s.bytes };
    },
  },
];

const NOT_APPLICABLE: [string, string][] = [
  ["annotation editing", "no create/edit/delete-annotation operation exists in LayahTools"],
  ["pdf-to-image, extract-text, analyze-structure, extract-tables, pdf-to-word, pdf-to-excel, metadata", "produce no PDF, so there is nothing to preserve"],
];

type Result = "PASS" | "PARTIAL" | "FAIL";
interface Cell { result: Result; notes: string[] }
const rank: Record<Result, number> = { PASS: 0, PARTIAL: 1, FAIL: 2 };
const typeOf = (a: AnnotationInfo) => (a.subtype === "Link" ? (a.uri ? "Link (URI)" : "Link (GoTo)") : a.subtype);

function classify(op: Op, before: AnnotationInspection, after: AnnotationInspection, pageMap: (number | null)[]): { type: string; result: Result; note: string }[] {
  const out: { type: string; result: Result; note: string }[] = [];
  const diff = compareAnnotations(before, after, { pageMap });
  const modified = new Map(diff.modified.map((m) => [`${m.before.pageIndex}:${m.before.index}`, m]));
  const missing = new Set(diff.missing.map((m) => `${m.pageIndex}:${m.index}`));
  const removed = new Set(diff.removedWithPage.map((m) => `${m.pageIndex}:${m.index}`));
  const findAfter = (a: AnnotationInfo): AnnotationInfo | undefined => {
    const dest = pageMap[a.pageIndex];
    if (dest === null || dest === undefined) return undefined;
    return after.pages[dest]?.find((x) => (a.name ? x.name === a.name : x.subtype === a.subtype && JSON.stringify(x.rect) === JSON.stringify(a.rect)));
  };
  for (const a of before.pages.flat()) {
    const k = `${a.pageIndex}:${a.index}`;
    const type = typeOf(a);
    const isW = a.subtype === "Widget";
    if (removed.has(k)) { out.push({ type, result: "PASS", note: "removed with its page, as intended" }); continue; }
    if (isW && op.removesWidgets) { out.push({ type, result: after.byType.Widget ? "FAIL" : "PASS", note: after.byType.Widget ? "widgets remain after flatten" : "removed on purpose (flattened into page content)" }); continue; }
    if (missing.has(k)) { out.push({ type, result: "FAIL", note: "lost unexpectedly" }); continue; }
    const aft = findAfter(a);
    const changes = (modified.get(k)?.changes ?? []).filter((c) => !(isW && op.regeneratesWidgetAppearance && c.field === "hasAppearance"));
    if (changes.length) { out.push({ type, result: "FAIL", note: `changed: ${changes.map((c) => `${c.field} ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`).join("; ")}` }); continue; }
    if (!aft) { out.push({ type, result: "FAIL", note: "could not be matched in the output" }); continue; }
    if (a.appearanceDigest !== aft.appearanceDigest && !(isW && op.regeneratesWidgetAppearance)) { out.push({ type, result: "FAIL", note: "appearance stream bytes changed" }); continue; }
    const partial: string[] = [];
    if (a.pageRefOk && !aft.pageRefOk) partial.push("/P no longer points at its page");
    if (a.destPage !== null) {
      const want = pageMap[a.destPage];
      if (want === null || want === undefined) partial.push("link target page was removed");
      else if (aft.destPage !== want) partial.push(`link target lost (goes to ${aft.destPage === -1 ? "a page outside the document" : `page ${(aft.destPage ?? -2) + 1}`}, expected page ${want + 1})`);
    }
    if (isW && a.inAcroForm && !aft.inAcroForm) partial.push("widget is no longer part of an AcroForm (not interactive)");
    const exp = op.exposed?.(a);
    if (exp) partial.push(exp);
    out.push(partial.length ? { type, result: "PARTIAL", note: partial.join("; ") } : { type, result: "PASS", note: "all compared properties equal" });
  }
  return out;
}

/** Measured non-PASS cells ("type|operation" -> result). Anything else must PASS. */
/**
 * Root causes (measured, see ALPHA_PHASE4_REPORT.md):
 *  - 8 ops rebuild through pdf-lib copyPages (merge, insert, split, extract x2, rearrange, compress, unlock): it copies each
 *    source page as an orphan /Page object, so every annotation's /P and every GoTo target points at the orphan; /AcroForm
 *    is not copied, so widgets stop being interactive.
 *  - redact only draws a box: annotations underneath keep their contents and appearance.
 */
const KNOWN: Record<string, Result> = {
  "Circle|compress (structural)": "PARTIAL",
  "Circle|extract pages (all)": "PARTIAL",
  "Circle|extract single page 1 (page-actions)": "PARTIAL",
  "Circle|insert pages (merge with a blank page)": "PARTIAL",
  "Circle|merge (2 copies)": "PARTIAL",
  "Circle|rearrange (reverse)": "PARTIAL",
  "Circle|redact (box over top of page 1)": "PARTIAL",
  "Circle|split (full range)": "PARTIAL",
  "Circle|unlock (copy pages)": "PARTIAL",
  "FreeText|compress (structural)": "PARTIAL",
  "FreeText|extract pages (all)": "PARTIAL",
  "FreeText|extract single page 1 (page-actions)": "PARTIAL",
  "FreeText|insert pages (merge with a blank page)": "PARTIAL",
  "FreeText|merge (2 copies)": "PARTIAL",
  "FreeText|rearrange (reverse)": "PARTIAL",
  "FreeText|split (full range)": "PARTIAL",
  "FreeText|unlock (copy pages)": "PARTIAL",
  "Highlight|compress (structural)": "PARTIAL",
  "Highlight|extract page 2 only": "PARTIAL",
  "Highlight|extract pages (all)": "PARTIAL",
  "Highlight|extract single page 1 (page-actions)": "PARTIAL",
  "Highlight|insert pages (merge with a blank page)": "PARTIAL",
  "Highlight|merge (2 copies)": "PARTIAL",
  "Highlight|rearrange (reverse)": "PARTIAL",
  "Highlight|redact (box over top of page 1)": "PARTIAL",
  "Highlight|split (full range)": "PARTIAL",
  "Highlight|unlock (copy pages)": "PARTIAL",
  "Ink|compress (structural)": "PARTIAL",
  "Ink|extract pages (all)": "PARTIAL",
  "Ink|extract single page 1 (page-actions)": "PARTIAL",
  "Ink|insert pages (merge with a blank page)": "PARTIAL",
  "Ink|merge (2 copies)": "PARTIAL",
  "Ink|rearrange (reverse)": "PARTIAL",
  "Ink|redact (box over top of page 1)": "PARTIAL",
  "Ink|split (full range)": "PARTIAL",
  "Ink|unlock (copy pages)": "PARTIAL",
  "Line|compress (structural)": "PARTIAL",
  "Line|extract pages (all)": "PARTIAL",
  "Line|extract single page 1 (page-actions)": "PARTIAL",
  "Line|insert pages (merge with a blank page)": "PARTIAL",
  "Line|merge (2 copies)": "PARTIAL",
  "Line|rearrange (reverse)": "PARTIAL",
  "Line|redact (box over top of page 1)": "PARTIAL",
  "Line|split (full range)": "PARTIAL",
  "Line|unlock (copy pages)": "PARTIAL",
  "Link (GoTo)|compress (structural)": "PARTIAL",
  "Link (GoTo)|extract pages (all)": "PARTIAL",
  "Link (GoTo)|extract single page 1 (page-actions)": "PARTIAL",
  "Link (GoTo)|insert pages (merge with a blank page)": "PARTIAL",
  "Link (GoTo)|merge (2 copies)": "PARTIAL",
  "Link (GoTo)|rearrange (reverse)": "PARTIAL",
  "Link (GoTo)|split (full range)": "PARTIAL",
  "Link (GoTo)|unlock (copy pages)": "PARTIAL",
  "Link (URI)|compress (structural)": "PARTIAL",
  "Link (URI)|extract pages (all)": "PARTIAL",
  "Link (URI)|extract single page 1 (page-actions)": "PARTIAL",
  "Link (URI)|insert pages (merge with a blank page)": "PARTIAL",
  "Link (URI)|merge (2 copies)": "PARTIAL",
  "Link (URI)|rearrange (reverse)": "PARTIAL",
  "Link (URI)|split (full range)": "PARTIAL",
  "Link (URI)|unlock (copy pages)": "PARTIAL",
  "Popup|compress (structural)": "PARTIAL",
  "Popup|extract pages (all)": "PARTIAL",
  "Popup|extract single page 1 (page-actions)": "PARTIAL",
  "Popup|insert pages (merge with a blank page)": "PARTIAL",
  "Popup|merge (2 copies)": "PARTIAL",
  "Popup|rearrange (reverse)": "PARTIAL",
  "Popup|split (full range)": "PARTIAL",
  "Popup|unlock (copy pages)": "PARTIAL",
  "Square|compress (structural)": "PARTIAL",
  "Square|extract pages (all)": "PARTIAL",
  "Square|extract single page 1 (page-actions)": "PARTIAL",
  "Square|insert pages (merge with a blank page)": "PARTIAL",
  "Square|merge (2 copies)": "PARTIAL",
  "Square|rearrange (reverse)": "PARTIAL",
  "Square|split (full range)": "PARTIAL",
  "Square|unlock (copy pages)": "PARTIAL",
  "Squiggly|compress (structural)": "PARTIAL",
  "Squiggly|extract pages (all)": "PARTIAL",
  "Squiggly|extract single page 1 (page-actions)": "PARTIAL",
  "Squiggly|insert pages (merge with a blank page)": "PARTIAL",
  "Squiggly|merge (2 copies)": "PARTIAL",
  "Squiggly|rearrange (reverse)": "PARTIAL",
  "Squiggly|redact (box over top of page 1)": "PARTIAL",
  "Squiggly|split (full range)": "PARTIAL",
  "Squiggly|unlock (copy pages)": "PARTIAL",
  "Stamp|compress (structural)": "PARTIAL",
  "Stamp|extract pages (all)": "PARTIAL",
  "Stamp|extract single page 1 (page-actions)": "PARTIAL",
  "Stamp|insert pages (merge with a blank page)": "PARTIAL",
  "Stamp|merge (2 copies)": "PARTIAL",
  "Stamp|rearrange (reverse)": "PARTIAL",
  "Stamp|redact (box over top of page 1)": "PARTIAL",
  "Stamp|split (full range)": "PARTIAL",
  "Stamp|unlock (copy pages)": "PARTIAL",
  "StrikeOut|compress (structural)": "PARTIAL",
  "StrikeOut|extract pages (all)": "PARTIAL",
  "StrikeOut|extract single page 1 (page-actions)": "PARTIAL",
  "StrikeOut|insert pages (merge with a blank page)": "PARTIAL",
  "StrikeOut|merge (2 copies)": "PARTIAL",
  "StrikeOut|rearrange (reverse)": "PARTIAL",
  "StrikeOut|redact (box over top of page 1)": "PARTIAL",
  "StrikeOut|split (full range)": "PARTIAL",
  "StrikeOut|unlock (copy pages)": "PARTIAL",
  "Text|compress (structural)": "PARTIAL",
  "Text|extract pages (all)": "PARTIAL",
  "Text|extract single page 1 (page-actions)": "PARTIAL",
  "Text|insert pages (merge with a blank page)": "PARTIAL",
  "Text|merge (2 copies)": "PARTIAL",
  "Text|rearrange (reverse)": "PARTIAL",
  "Text|redact (box over top of page 1)": "PARTIAL",
  "Text|split (full range)": "PARTIAL",
  "Text|unlock (copy pages)": "PARTIAL",
  "Underline|compress (structural)": "PARTIAL",
  "Underline|extract pages (all)": "PARTIAL",
  "Underline|extract single page 1 (page-actions)": "PARTIAL",
  "Underline|insert pages (merge with a blank page)": "PARTIAL",
  "Underline|merge (2 copies)": "PARTIAL",
  "Underline|rearrange (reverse)": "PARTIAL",
  "Underline|redact (box over top of page 1)": "PARTIAL",
  "Underline|split (full range)": "PARTIAL",
  "Underline|unlock (copy pages)": "PARTIAL",
  "Widget|compress (structural)": "PARTIAL",
  "Widget|extract page 2 only": "PARTIAL",
  "Widget|extract pages (all)": "PARTIAL",
  "Widget|extract single page 1 (page-actions)": "PARTIAL",
  "Widget|insert pages (merge with a blank page)": "PARTIAL",
  "Widget|merge (2 copies)": "PARTIAL",
  "Widget|rearrange (reverse)": "PARTIAL",
  "Widget|split (full range)": "PARTIAL",
  "Widget|unlock (copy pages)": "PARTIAL",
};

async function main() {
  const grid = new Map<string, Cell>();
  const types = new Set<string>();
  const failures: string[] = [];
  let checks = 0;

  for (const fx of FIXTURES) {
    const src = read(fx.name);
    const before = await inspectAnnotations(src);
    for (const op of OPS) {
      let res: { type: string; result: Result; note: string }[];
      try {
        const out = await op.run(src, fx);
        let after = await inspectAnnotations(out.bytes);
        if (out.keepPages) after = { ...after, pages: after.pages.slice(0, out.keepPages) };
        res = classify(op, before, after, out.pageMap ?? before.pages.map((_, i) => i));
      } catch (e) {
        const note = `operation threw: ${(e as Error).message}`;
        res = before.pages.flat().map((a) => ({ type: typeOf(a), result: "FAIL" as Result, note }));
      }
      for (const r of res) {
        types.add(r.type);
        const key = `${r.type}|${op.id}`;
        const cell = grid.get(key) ?? { result: "PASS" as Result, notes: [] };
        if (rank[r.result] > rank[cell.result]) cell.result = r.result;
        if (r.result !== "PASS") cell.notes.push(`${fx.name}: ${r.note}`);
        grid.set(key, cell);
      }
    }
  }
  const typeList = [...types].sort();
  const allKeys = typeList.flatMap((t) => OPS.map((o) => `${t}|${o.id}`));

  console.log("=== A-4.4 ANNOTATION PRESERVATION MATRIX ===\n");
  console.log(`Fixtures: ${FIXTURES.map((f) => f.name).join(", ")}; ${typeList.length} annotation types x ${OPS.length} operations = ${allKeys.length} cells\n`);
  const tally: Record<Result, number> = { PASS: 0, PARTIAL: 0, FAIL: 0 };
  for (const k of allKeys) { const c = grid.get(k); if (c) tally[c.result]++; }
  console.log(`Measured: ${tally.PASS} PASS, ${tally.PARTIAL} PARTIAL, ${tally.FAIL} FAIL\n`);
  for (const k of allKeys) {
    const c = grid.get(k);
    if (c && c.result !== "PASS") console.log(`${c.result.padEnd(7)} ${k.replace("|", "  x  ")}\n        ${[...new Set(c.notes)].join(" | ")}`);
  }

  const check = (name: string, ok: boolean, detail?: string) => {
    checks++;
    if (!ok) { failures.push(name); console.log(`FAIL  ${name}${detail ? ` (${detail})` : ""}`); }
  };
  for (const k of allKeys) {
    const got = grid.get(k)?.result;
    check(`${k.replace("|", " x ")} is ${KNOWN[k] ?? "PASS"}`, got !== undefined && got === (KNOWN[k] ?? "PASS"), `got ${got}`);
  }
  for (const k of Object.keys(KNOWN)) check(`KNOWN entry still exists: ${k}`, grid.has(k));
  check("all 15 annotation kinds are exercised", typeList.length === 15, `${typeList.length}: ${typeList.join(", ")}`);

  if (process.argv.includes("--print")) {
    const lines = ["| Annotation Type | Operation | Expected Behaviour | Actual Behaviour | Result |", "|---|---|---|---|---|"];
    for (const t of typeList) {
      for (const o of OPS) {
        const c = grid.get(`${t}|${o.id}`)!;
        const actual = c.result === "PASS" ? "All compared properties equal" : [...new Set(c.notes)].join("; ").replace(/\|/g, "/");
        lines.push(`| ${t} | ${o.id} | ${o.expected} | ${actual} | ${c.result} |`);
      }
    }
    for (const [op, why] of NOT_APPLICABLE) lines.push(`| (all) | ${op} | - | ${why} | NOT APPLICABLE |`);
    fs.mkdirSync(path.resolve(__dirname, "../tests/visual-diff-output"), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, "../tests/visual-diff-output/annotation-matrix.md"), lines.join("\n") + "\n");
    console.log("\nwrote tests/visual-diff-output/annotation-matrix.md");
  }

  console.log(`\n=================================================`);
  console.log(failures.length ? `${failures.length} OF ${checks} MATRIX CHECKS FAILED` : `ALL ${checks} MATRIX CHECKS PASSED`);
  console.log(`=================================================\n`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
