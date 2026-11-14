import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PDFDocument, PDFTextField } from "pdf-lib";
import { loadPageTexts } from "./lib/pdf-text-pages";
import { loadPathObjects, tableFromRules, PathObject } from "./lib/pdf-paths";
import { Box, ExpectedOutput, normText } from "./lib/expected-schema";
import { groupIntoLines, TextLine } from "../src/lib/interpretation/text-lines";
import { detectRepeatedElements } from "../src/lib/interpretation/repeated-elements";
import { detectLists } from "../src/lib/interpretation/lists";
import type { PageText } from "../src/lib/interpretation/types";

/**
 * A-3.3: validates every labeled expected output in tests/fixtures/pdf-corpus/expected/ against the real PDF.
 * Everything measurable is re-measured from the file (PDFium text + vector paths, pdf-lib AcroForm), nothing is trusted
 * from the JSON except what a human labelled (roles, zones, reading order, which window holds which region).
 */

const CORPUS = "tests/fixtures/pdf-corpus/";
const EXPECTED_DIR = CORPUS + "expected/";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const boxNear = (a: Box, b: Box, tol: number) => near(a.left, b.left, tol) && near(a.bottom, b.bottom, tol) && near(a.right, b.right, tol) && near(a.top, b.top, tol);
const union = (bs: Box[]): Box => ({ left: Math.min(...bs.map((b) => b.left)), bottom: Math.min(...bs.map((b) => b.bottom)), right: Math.max(...bs.map((b) => b.right)), top: Math.max(...bs.map((b) => b.top)) });
const cen = (l: TextLine) => ({ x: (l.bounds.left + l.bounds.right) / 2, y: (l.bounds.bottom + l.bounds.top) / 2 });
const inBox = (l: TextLine, w: Box) => {
  const c = cen(l);
  return c.x >= w.left && c.x <= w.right && c.y >= w.bottom && c.y <= w.top;
};
const order = (ls: TextLine[]) => [...ls].sort((a, b) => cen(b).y - cen(a).y || a.bounds.left - b.bounds.left);
const fmt = (b: Box) => `[${[b.left, b.bottom, b.right, b.top].map((n) => Math.round(n * 100) / 100).join(",")}]`;

interface Ctx {
  bytes: Buffer;
  pages: PageText[];
  paths: PathObject[];
  manifest: { fixtures: { name: string; sha256: string; pageCount: number }[] };
}

async function loadCtx(fixture: string): Promise<Ctx> {
  const bytes = fs.readFileSync(CORPUS + fixture);
  return {
    bytes,
    pages: await loadPageTexts(CORPUS + fixture),
    paths: await loadPathObjects(new Uint8Array(bytes)),
    manifest: JSON.parse(fs.readFileSync(CORPUS + "manifest.json", "utf-8")),
  };
}

/** Returns a list of human-readable problems; empty = the expected output matches the PDF. */
async function validate(exp: ExpectedOutput, ctx: Ctx): Promise<string[]> {
  const errs: string[] = [];
  const e = (m: string) => errs.push(m);
  const tol = exp.tolerance;

  // ---- identity ----
  if (exp.schemaVersion !== 1) e(`schemaVersion ${exp.schemaVersion}`);
  const sha = crypto.createHash("sha256").update(ctx.bytes).digest("hex");
  if (sha !== exp.sha256) e(`sha256 differs from the file (${sha.slice(0, 12)} vs ${String(exp.sha256).slice(0, 12)})`);
  const man = ctx.manifest.fixtures.find((f) => f.name === exp.fixture);
  if (!man) e("fixture is not in manifest.json");
  else {
    if (man.sha256 !== exp.sha256) e("sha256 differs from manifest.json");
    if (man.pageCount !== exp.pageCount) e(`pageCount ${exp.pageCount} differs from manifest ${man.pageCount}`);
  }
  const doc = await PDFDocument.load(ctx.bytes);
  if (doc.getPageCount() !== exp.pageCount || ctx.pages.length !== exp.pageCount || exp.pages.length !== exp.pageCount) e("pageCount mismatch (pdf-lib / PDFium / expected pages)");
  if (!exp.limitations?.length || exp.limitations.some((s) => typeof s !== "string" || !s.trim())) e("limitations must be a non-empty list of strings");
  if (!Array.isArray(exp.uncertain)) e("uncertain must be a list");
  for (const k of ["structure", "geometry", "text"] as const) if (!exp.provenance?.[k]) e(`provenance.${k} missing`);

  for (const ep of exp.pages) {
    const pg = ctx.pages[ep.pageIndex];
    const P = `p${ep.pageIndex}`;
    if (!pg) {
      e(`${P}: page missing in PDF`);
      continue;
    }
    if (!near(pg.width, ep.width, 0.5) || !near(pg.height, ep.height, 0.5)) e(`${P}: size ${pg.width}x${pg.height} vs expected ${ep.width}x${ep.height}`);
    const lines = groupIntoLines(pg.items);
    const paths = ctx.paths.filter((p) => p.pageIndex === ep.pageIndex);
    const claims = new Map<TextLine, string>();
    const claim = (l: TextLine, id: string) => {
      if (claims.has(l)) e(`${P}: line ${JSON.stringify(l.text.slice(0, 30))} claimed by both ${claims.get(l)} and ${id}`);
      claims.set(l, id);
    };

    // ---- ids ----
    const regionIds = ep.textRegions.map((r) => r.id);
    const figIds = (ep.figures ?? []).map((f) => f.id);
    const tabIds = (ep.tables ?? []).map((t) => t.id);
    const fieldIds = (ep.formFields ?? []).map((f) => f.name);
    const allIds = [...regionIds, ...figIds, ...tabIds, ...fieldIds];
    if (new Set(allIds).size !== allIds.length) e(`${P}: duplicate ids`);

    // ---- figures (claim their text first) ----
    for (const fg of ep.figures ?? []) {
      const ps = paths.filter((p) => p.bounds.left >= fg.pathWindow.left && p.bounds.right <= fg.pathWindow.right && p.bounds.bottom >= fg.pathWindow.bottom && p.bounds.top <= fg.pathWindow.top);
      if (!ps.length) e(`${fg.id}: no vector paths in pathWindow`);
      else if (!boxNear(union(ps.map((p) => p.bounds)), fg.bounds, tol.vector)) e(`${fg.id}: path union ${fmt(union(ps.map((p) => p.bounds)))} vs expected ${fmt(fg.bounds)}`);
      if (fg.containsText) lines.filter((l) => inBox(l, fg.pathWindow)).forEach((l) => claim(l, fg.id));
    }

    // ---- tables ----
    for (const t of ep.tables ?? []) {
      const win: Box = { left: t.bounds.left - 0.5, bottom: t.bounds.bottom - 0.5, right: t.bounds.right + 0.5, top: t.bounds.top + 0.5 };
      const rt = tableFromRules(paths, win);
      if (!rt) {
        e(`${t.id}: no ruled grid found inside ${fmt(t.bounds)}`);
        continue;
      }
      if (!boxNear(rt.bounds, t.bounds, tol.vector)) e(`${t.id}: bounds ${fmt(rt.bounds)} vs expected ${fmt(t.bounds)}`);
      const rows = rt.rowEdgesY.length - 1;
      const cols = rt.colEdgesX.length - 1;
      if (rows !== t.rows) e(`${t.id}: ${rows} rows measured vs ${t.rows} expected`);
      if (cols !== t.columns) e(`${t.id}: ${cols} columns measured vs ${t.columns} expected`);
      if (t.rowEdgesY.length !== t.rows + 1 || t.colEdgesX.length !== t.columns + 1) e(`${t.id}: edge counts inconsistent with rows/columns`);
      if (rt.rowEdgesY.length !== t.rowEdgesY.length || rt.rowEdgesY.some((y, i) => !near(y, t.rowEdgesY[i], tol.vector))) e(`${t.id}: row edges ${rt.rowEdgesY.map((n) => Math.round(n * 100) / 100)} vs ${t.rowEdgesY}`);
      if (rt.colEdgesX.length !== t.colEdgesX.length || rt.colEdgesX.some((x, i) => !near(x, t.colEdgesX[i], tol.vector))) e(`${t.id}: column edges ${rt.colEdgesX.map((n) => Math.round(n * 100) / 100)} vs ${t.colEdgesX}`);
      if (JSON.stringify(rt.merged) !== JSON.stringify(t.merged)) e(`${t.id}: merged cells ${JSON.stringify(rt.merged)} vs ${JSON.stringify(t.merged)}`);
      const cells: string[][] = Array.from({ length: rows }, () => Array(cols).fill(""));
      const buckets = new Map<string, TextLine[]>();
      for (const l of lines.filter((x) => inBox(x, rt.bounds))) {
        claim(l, t.id);
        const c = cen(l);
        const r = rt.rowEdgesY.findIndex((y, i) => i + 1 < rt.rowEdgesY.length && c.y <= y && c.y >= rt.rowEdgesY[i + 1]);
        let col = rt.colEdgesX.findIndex((x, i) => i + 1 < rt.colEdgesX.length && c.x >= x && c.x <= rt.colEdgesX[i + 1]);
        const m = rt.merged.find((mm) => mm.row === r);
        if (m) col = m.colStart;
        if (r < 0 || col < 0) {
          e(`${t.id}: text ${JSON.stringify(l.text)} outside the grid`);
          continue;
        }
        const k = `${r}:${col}`;
        const b = buckets.get(k);
        if (b) b.push(l);
        else buckets.set(k, [l]);
      }
      for (const [k, ls] of buckets) {
        const [r, c] = k.split(":").map(Number);
        cells[r][c] = normText(order(ls).map((l) => l.text).join(" "));
      }
      if (JSON.stringify(cells) !== JSON.stringify(t.cells)) e(`${t.id}: cell text differs: measured ${JSON.stringify(cells)}`);
    }

    // ---- text regions ----
    for (const r of ep.textRegions) {
      const win: Box = { left: r.bounds.left - tol.textBounds, bottom: r.bounds.bottom - tol.textBounds, right: r.bounds.right + tol.textBounds, top: r.bounds.top + tol.textBounds };
      const ls = order(lines.filter((l) => inBox(l, win)));
      if (!ls.length) {
        e(`${r.id}: no text found at ${fmt(r.bounds)}`);
        continue;
      }
      ls.forEach((l) => claim(l, r.id));
      const mb = union(ls.map((l) => l.bounds));
      if (!boxNear(mb, r.bounds, tol.textBounds)) e(`${r.id}: measured bounds ${fmt(mb)} vs expected ${fmt(r.bounds)}`);
      const text = normText(ls.map((l) => l.text).join(" "));
      if (!text.startsWith(r.textStart)) e(`${r.id}: text starts ${JSON.stringify(text.slice(0, r.textStart.length))} not ${JSON.stringify(r.textStart)}`);
      if (!text.endsWith(r.textEnd)) e(`${r.id}: text ends ${JSON.stringify(text.slice(-r.textEnd.length))} not ${JSON.stringify(r.textEnd)}`);
      if (r.continuesFrom && !exp.pages.some((p) => p.textRegions.some((x) => x.id === r.continuesFrom))) e(`${r.id}: continuesFrom ${r.continuesFrom} does not exist`);
    }
    // every text line on the page must be accounted for (no orphans)
    for (const l of lines) if (!claims.has(l)) e(`${P}: unlabelled text ${JSON.stringify(l.text.slice(0, 40))} at ${fmt(l.bounds)}`);

    // ---- form fields (pdf-lib reads the AcroForm; PDFium never sees widget values) ----
    if (ep.formFields) {
      const fields = doc.getForm().getFields();
      if (fields.length !== ep.formFields.length) e(`${P}: ${fields.length} form fields in the PDF vs ${ep.formFields.length} expected`);
      for (const ef of ep.formFields) {
        const f = fields.find((x) => x.getName() === ef.name);
        if (!f) {
          e(`field ${ef.name}: not in the PDF`);
          continue;
        }
        if (!(f instanceof PDFTextField) || ef.type !== "text") e(`field ${ef.name}: type ${f.constructor.name} vs ${ef.type}`);
        else if (f.getText() !== ef.value) e(`field ${ef.name}: value ${JSON.stringify(f.getText())} vs ${JSON.stringify(ef.value)}`);
        const q = f.acroField.getWidgets()[0]?.getRectangle();
        if (!q || !boxNear({ left: q.x, bottom: q.y, right: q.x + q.width, top: q.y + q.height }, ef.bounds, tol.formRect)) e(`field ${ef.name}: rect differs from ${fmt(ef.bounds)}`);
        const label = ep.textRegions.find((r) => r.id === ef.labelRegionId);
        if (!label) e(`field ${ef.name}: label region ${ef.labelRegionId} does not exist`);
        else if (!(label.bounds.right < ef.bounds.left && Math.min(label.bounds.top, ef.bounds.top) - Math.max(label.bounds.bottom, ef.bounds.bottom) > 0)) e(`field ${ef.name}: label is not immediately left of the field on the same line`);
        if (pg.items.some((i) => normText(i.text).includes(ef.value))) e(`field ${ef.name}: value unexpectedly appears as a page text object`);
      }
    } else if (doc.getForm().getFields().length) e(`${P}: PDF has form fields but expected output lists none`);

    // ---- reading order ----
    const ro = ep.readingOrder;
    if (ro.length !== allIds.length || new Set(ro).size !== ro.length || ro.some((id) => !allIds.includes(id))) e(`${P}: readingOrder is not a permutation of the page's ids`);
    else {
      const meta = new Map<string, { zone?: string; b?: Box }>();
      for (const r of ep.textRegions) meta.set(r.id, { zone: r.zone, b: r.bounds });
      for (const f of ep.figures ?? []) meta.set(f.id, { zone: f.zone, b: f.bounds });
      for (const t of ep.tables ?? []) meta.set(t.id, { zone: t.zone, b: t.bounds });
      for (const f of ep.formFields ?? []) meta.set(f.name, {});
      const rank: Record<string, number> = { full: 0, left: 1, right: 2 };
      let prev: { id: string; zone?: string; b?: Box } | undefined;
      for (const id of ro) {
        const m = meta.get(id)!;
        if (m.zone && prev?.zone) {
          if (rank[m.zone] < rank[prev.zone]) e(`${P}: ${id} (${m.zone}) comes after ${prev.id} (${prev.zone}); expected full -> left -> right`);
          else if (m.zone === prev.zone && m.zone !== "full" && m.b && prev.b && m.b.top > prev.b.bottom + tol.textBounds) e(`${P}: ${id} is not below ${prev.id} within the ${m.zone} column`);
        }
        if (m.zone) prev = { id, ...m };
      }
    }

    // ---- cross-check with the A-3.2 list detector ----
    const detected = detectLists(pg.items).map((l) => ({ type: l.type, items: l.items.map((i) => normText(i.text)) }));
    const expectedLists = (ep.lists ?? []).map((l) => ({ type: l.type, items: l.items }));
    if (JSON.stringify(detected) !== JSON.stringify(expectedLists)) e(`${P}: detectLists ${JSON.stringify(detected)} vs expected lists ${JSON.stringify(expectedLists)}`);
  }

  // ---- cross-check with the A-3.1 header/footer detector ----
  if (exp.repeatedElements) {
    const found = detectRepeatedElements(ctx.pages).map((r) => ({ kind: r.kind, text: r.text, pageIndexes: r.pageIndexes }));
    if (JSON.stringify(found) !== JSON.stringify(exp.repeatedElements)) e(`detectRepeatedElements ${JSON.stringify(found)} vs expected ${JSON.stringify(exp.repeatedElements)}`);
  }
  return errs;
}

/** Deep clone so negative tests can corrupt a copy. */
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

async function main() {
  const files = fs.readdirSync(EXPECTED_DIR).filter((f) => f.endsWith(".expected.json")).sort();
  const wanted = ["form-acroform", "multi-column", "table-heavy"];
  check("expected outputs exist for the table-heavy, multi-column and form fixtures", JSON.stringify(files.map((f) => f.replace(".expected.json", ""))) === JSON.stringify(wanted), files.join(", "));

  const loaded: { exp: ExpectedOutput; ctx: Ctx }[] = [];
  for (const f of files) {
    const exp: ExpectedOutput = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, f), "utf-8"));
    check(`${f}: file name matches fixture`, f === exp.fixture.replace(/\.pdf$/, ".expected.json"));
    const ctx = await loadCtx(exp.fixture);
    const errs = await validate(exp, ctx);
    check(`${exp.fixture}: expected output matches the real PDF`, errs.length === 0, errs.slice(0, 6).join(" | "));
    check(`${exp.fixture}: deterministic (second validation identical)`, JSON.stringify(await validate(exp, ctx)) === JSON.stringify(errs));
    loaded.push({ exp, ctx });
  }

  // ---- the validator must reject wrong expectations ----
  const get = (name: string) => loaded.find((x) => x.exp.fixture === name)!;
  const neg = async (label: string, fixture: string, mutate: (e: ExpectedOutput) => void, expectMention: RegExp) => {
    const { exp, ctx } = get(fixture);
    const bad = clone(exp);
    mutate(bad);
    const errs = await validate(bad, ctx);
    check(`rejects: ${label}`, errs.some((m) => expectMention.test(m)), errs[0] ?? "no error reported");
  };
  await neg("wrong table row count", "table-heavy.pdf", (e) => { e.pages[0].tables![0].rows = 6; }, /rows measured/);
  await neg("wrong table column count", "table-heavy.pdf", (e) => { e.pages[0].tables![0].columns = 5; }, /columns measured/);
  await neg("table bounds shifted inward (grid no longer found)", "table-heavy.pdf", (e) => { e.pages[0].tables![0].bounds.left += 5; }, /no ruled grid|bounds/);
  await neg("table bounds shifted outward", "table-heavy.pdf", (e) => { e.pages[0].tables![0].bounds.left -= 3; }, /bounds/);
  await neg("wrong cell text", "table-heavy.pdf", (e) => { e.pages[0].tables![0].cells[2][1] = "$999"; }, /cell text/);
  await neg("wrong merged-cell claim", "multi-column.pdf", (e) => { e.pages[2].tables![0].merged = []; }, /merged cells/);
  await neg("text region bounds off by 10pt", "multi-column.pdf", (e) => { e.pages[0].textRegions[4].bounds.top += 10; }, /bounds|no text/);
  await neg("wrong text anchor", "multi-column.pdf", (e) => { e.pages[0].textRegions[0].textStart = "Not the title"; }, /text starts/);
  await neg("region removed (orphan text)", "multi-column.pdf", (e) => { e.pages[1].textRegions.splice(3, 1); e.pages[1].readingOrder = e.pages[1].readingOrder.filter((id) => id !== "p1-sec31-body"); }, /unlabelled text/);
  await neg("reading order missing an id", "multi-column.pdf", (e) => { e.pages[0].readingOrder.pop(); }, /permutation/);
  await neg("right column read before left", "multi-column.pdf", (e) => { const o = e.pages[0].readingOrder; o.push(o.splice(o.indexOf("p0-abstract-heading"), 1)[0]); }, /expected full -> left -> right|not below/);
  await neg("claimed list missing", "multi-column.pdf", (e) => { e.pages[1].lists = []; }, /detectLists/);
  await neg("a header that does not exist", "multi-column.pdf", (e) => { e.repeatedElements = [{ kind: "HEADER", text: "x", pageIndexes: [0, 1] }]; }, /detectRepeatedElements/);
  await neg("wrong checksum", "multi-column.pdf", (e) => { e.sha256 = "0".repeat(64); }, /sha256/);
  await neg("wrong form value", "form-acroform.pdf", (e) => { e.pages[0].formFields![0].value = "Jane"; }, /value/);
  await neg("wrong form field name", "form-acroform.pdf", (e) => { e.pages[0].formFields![1].name = "applicant.phone"; e.pages[0].readingOrder = e.pages[0].readingOrder.map((i) => (i === "applicant.email" ? "applicant.phone" : i)); }, /not in the PDF/);
  await neg("form rect off by 5pt", "form-acroform.pdf", (e) => { e.pages[0].formFields![0].bounds.left += 5; }, /rect differs/);
  await neg("form field listed as none", "form-acroform.pdf", (e) => { delete e.pages[0].formFields; e.pages[0].readingOrder = e.pages[0].readingOrder.filter((i) => !i.startsWith("applicant.")); }, /form fields/);

  console.log(failed ? `\n${failed} FAILED` : "\nALL EXPECTED-OUTPUT VALIDATIONS PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
