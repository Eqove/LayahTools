import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { PDFDocument, PDFName } from "pdf-lib";
import { compareAnnotations, inspectAnnotations } from "../src/lib/pdf/annotations";
import { FormError, fillForm, flattenForm, inspectForFlatten, readFormFields, verifyFlattened } from "../src/lib/pdf/forms";
import { FPDF_ANNOT, VisualDiffEngine } from "./lib/visual-diff";
import { loadPdfJsNode } from "./lib/pdfjs-node";

const CORPUS = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const read = (n: string) => new Uint8Array(fs.readFileSync(path.join(CORPUS, n)));
const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return e instanceof FormError ? e.code : `OTHER:${(e as Error).message}`;
  }
};

async function pageTexts(pdfjs: any, bytes: Uint8Array): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x: { str?: string }) => x.str ?? "").join(" "));
  await task.destroy();
  return out;
}
async function pdfjsAnnotTypes(pdfjs: any, bytes: Uint8Array): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) for (const a of await (await doc.getPage(i)).getAnnotations()) out.push(a.subtype);
  await task.destroy();
  return out;
}

async function main() {
  console.log("=== A-4.3 FLATTEN FORMS ===\n");
  const pdfjs = await loadPdfJsNode();
  const engine = new VisualDiffEngine();

  // 1. Pre-flatten inspection (what the confirmation dialog shows)
  console.log("--- 1. Inspect before flattening ---");
  const markup = read("annotations-markup.pdf");
  const pre = await inspectForFlatten(markup);
  check("detects the form field and its widget", pre.fieldCount === 1 && pre.widgetCount === 1);
  check("lists the other annotations by type (they will be kept, not flattened)", pre.keptTotal === 10 && pre.keptByType.Highlight === 2 && pre.keptByType.Ink === 1 && pre.keptByType.Widget === undefined, JSON.stringify(pre.keptByType));
  const preAll = await inspectForFlatten(read("form-all-fields.pdf"));
  check("form-all-fields: 10 fields, 2 widgets without appearance flagged as empty", preAll.fieldCount === 10 && preAll.emptyAppearanceFields.join() === "s.signature", preAll.emptyAppearanceFields.join());
  const noForm = await inspectForFlatten(read("simple-text.pdf"));
  check("PDF without a form: nothing to flatten", noForm.fieldCount === 0 && noForm.widgetCount === 0);

  // 2. Flatten a form that also carries markup annotations
  console.log("\n--- 2. Form + markup annotations ---");
  const beforeSha = sha(markup);
  const beforeAnn = await inspectAnnotations(markup);
  const before = await pageTexts(pdfjs, markup);
  check("before flattening the field text is NOT page content", !before[0].includes("A. Reviewer"));
  const res = await flattenForm(markup);
  check("original bytes are unchanged", sha(markup) === beforeSha);
  const afterAnn = await inspectAnnotations(res.bytes);
  check("output reopens with the same page count", (await PDFDocument.load(res.bytes)).getPageCount() === 2);
  check("no form fields remain", (await readFormFields(res.bytes)).fields.length === 0 && !(await readFormFields(res.bytes)).hasAcroForm);
  check("no widget annotations remain and none dangle", (afterAnn.byType.Widget ?? 0) === 0 && afterAnn.dangling === 0, JSON.stringify(afterAnn.byType) + ` dangling ${afterAnn.dangling}`);
  const strip = (i: typeof beforeAnn) => ({ ...i, pages: i.pages.map((p) => p.filter((a) => a.subtype !== "Widget")) });
  const kept = compareAnnotations(strip(beforeAnn), strip(afterAnn));
  check("all 10 markup annotations are preserved unchanged (type, rect, colour, contents, flags)", kept.ok && afterAnn.total === 10, kept.messages.join("; "));
  check("report says so: 10 annotations kept, not flattened", res.report.annotationsKept === 10 && res.report.fieldsFlattened === 1 && res.report.widgetsRemoved === 1, JSON.stringify(res.report));
  const after = await pageTexts(pdfjs, res.bytes);
  check("flattened field value is now ordinary page text (PDF.js)", after[0].includes("A. Reviewer"), after[0].slice(-60));
  check("an independent parser (PDF.js) sees no widget and all markup", !(await pdfjsAnnotTypes(pdfjs, res.bytes)).includes("Widget") && (await pdfjsAnnotTypes(pdfjs, res.bytes)).filter((t) => t === "Highlight").length === 2);
  check("report verification checks all passed", res.report.verification.length >= 5 && res.report.verification.every((v) => v.ok), res.report.verification.filter((v) => !v.ok).map((v) => v.check).join());

  // Visual check with an independent renderer (PDFium, 1 px = 1 pt). PDFium draws markup annotations with FPDF_ANNOT but
  // draws form widgets only through its form-fill pass, so before flattening the widgets are invisible to this render.
  // Therefore: outside the widget rectangles the page must be pixel-identical (markup untouched, nothing else disturbed),
  // and inside them the flattened page must now show the field content.
  const widgetMasks = (ann: typeof beforeAnn, pageIndex: number, height: number) =>
    ann.pages[pageIndex].filter((a) => a.subtype === "Widget" && a.rect).map((a) => ({ left: Math.floor(a.rect![0]) - 2, right: Math.ceil(a.rect![2]) + 2, top: Math.floor(height - a.rect![3]) - 2, bottom: Math.ceil(height - a.rect![1]) + 2 }));
  for (const p of [0, 1]) {
    const a = await engine.renderPageToRgba(markup, p, 595, 842, FPDF_ANNOT);
    const b = await engine.renderPageToRgba(res.bytes, p, 595, 842, FPDF_ANNOT);
    const d = engine.compare(a, b, { masks: widgetMasks(beforeAnn, p, 842) });
    check(`PDFium render page ${p + 1}: identical outside the widget rectangles`, d.unaffectedRegionDiff === 0, `${d.unaffectedRegionDiff} px differ outside, ${d.affectedRegionDiff} px inside`);
    if (p === 0) check("PDFium render page 1: the reviewer field content now appears inside its rectangle", d.affectedRegionDiff > 50, `${d.affectedRegionDiff} px`);
  }

  // 3. Filled form flattens to its visible values
  console.log("\n--- 3. Filled form ---");
  const filled = (await fillForm(read("form-all-fields.pdf"), { "t.name": "Ada Lovelace", "t.comments": "line one\nline two", "t.code": "ABC12", "c.subscribe": true, "r.plan": "pro", "d.country": "Germany", "o.interests": ["Music", "Travel"] })).bytes;
  const filledSha = sha(filled);
  const flat = await flattenForm(filled);
  check("input bytes unchanged", sha(filled) === filledSha);
  check("all 10 fields flattened, none left", flat.report.fieldsFlattened === 10 && (await readFormFields(flat.bytes)).fields.length === 0, JSON.stringify({ n: flat.report.fieldsFlattened }));
  check("unsigned signature field without appearance is reported, not hidden", flat.report.emptyAppearanceFields.join() === "s.signature" && flat.report.warnings.some((w) => /s\.signature/.test(w)), flat.report.warnings.join(" | "));
  const text = (await pageTexts(pdfjs, flat.bytes))[0];
  check("text values are page text", ["Ada Lovelace", "ABC12", "Germany"].every((t) => text.includes(t)), text.slice(-120));
  const filledAnn = await inspectAnnotations(filled);
  const rf = await engine.renderPageToRgba(filled, 0, 595, 842, FPDF_ANNOT);
  const rb = await engine.renderPageToRgba(flat.bytes, 0, 595, 842, FPDF_ANNOT);
  const dm = engine.compare(rf, rb, { masks: widgetMasks(filledAnn, 0, 842) });
  check("filled form: identical outside the widget rectangles, content drawn inside them", dm.unaffectedRegionDiff === 0 && dm.affectedRegionDiff > 500, `${dm.unaffectedRegionDiff} px outside, ${dm.affectedRegionDiff} px inside`);
  const blankFlat = await flattenForm(read("form-all-fields.pdf"));
  const rBlank = await engine.renderPageToRgba(blankFlat.bytes, 0, 595, 842, FPDF_ANNOT);
  const rect = (name: string) => filledAnn.pages[0].find((x) => x.fieldName === name)!.rect!;
  const inkIn = (img: { data: Uint8Array; width: number }, r: number[], y0 = 0, y1 = 1e9) => {
    let n = 0;
    for (let y = Math.max(Math.floor(842 - r[3]), y0); y < Math.min(Math.ceil(842 - r[1]), y1); y++) for (let x = Math.floor(r[0]) + 2; x < Math.ceil(r[2]) - 2; x++) if (img.data[(y * img.width + x) * 4] < 120) n++;
    return n;
  };
  const cb = rect("c.subscribe");
  check("checked box is drawn (more ink than the flattened blank form)", inkIn(rb, cb) > inkIn(rBlank, cb) + 5, `${inkIn(rb, cb)} vs ${inkIn(rBlank, cb)} px`);
  const comments = rect("t.comments");
  const mid = Math.floor(842 - comments[3]) + 26;
  // Count separate bands of text rows inside the box: two lines of text must give two bands.
  const bands = (img: { data: Uint8Array; width: number }, r: number[]) => {
    let n = 0;
    let inBand = false;
    for (let y = Math.floor(842 - r[3]) + 3; y < Math.ceil(842 - r[1]) - 3; y++) {
      let ink = 0;
      for (let x = Math.floor(r[0]) + 4; x < Math.ceil(r[2]) - 4; x++) if (img.data[(y * img.width + x) * 4] < 120) ink++;
      if (ink > 0 && !inBand) n++;
      inBand = ink > 0;
    }
    return n;
  };
  void mid;
  check("multiline field shows two separate lines of text", bands(rb, comments) === 2, `${bands(rb, comments)} text band(s)`);

  const plain = await flattenForm(read("form-acroform.pdf"));
  check("corpus form-acroform.pdf: flattened, values stay visible", (await readFormFields(plain.bytes)).fields.length === 0 && (await pageTexts(pdfjs, plain.bytes))[0].includes("John Doe"));

  // 4. Errors
  console.log("\n--- 4. Errors ---");
  check("no form -> NO_FORM", (await code(flattenForm(read("simple-text.pdf")))) === "NO_FORM");
  check("corrupt -> INVALID", (await code(flattenForm(new Uint8Array([9, 9, 9, 9])))) === "INVALID");
  check("password-protected -> PASSWORD", (await code(flattenForm(read("password-protected.pdf")))) === "PASSWORD");
  check("annotated.pdf (no form) -> NO_FORM, nothing flattened", (await code(flattenForm(read("annotated.pdf")))) === "NO_FORM");

  // 5. verifyFlattened must fail on bad outputs (otherwise the verification is decorative)
  console.log("\n--- 5. Verification catches bad output ---");
  const formAfter = await readFormFields(res.bytes);
  const good = verifyFlattened(beforeAnn, afterAnn, formAfter);
  check("verifyFlattened: good output has no problems", good.problems.length === 0, good.problems.join("; "));
  const withWidget = { ...afterAnn, byType: { ...afterAnn.byType, Widget: 1 } };
  check("a remaining widget is reported", verifyFlattened(beforeAnn, withWidget, formAfter).problems.some((p) => /widget/i.test(p)));
  const lost = { ...afterAnn, pages: afterAnn.pages.map((p, i) => (i === 0 ? p.filter((x) => x.name !== "ink-1") : p)), total: afterAnn.total - 1 };
  check("a lost markup annotation is reported by name", verifyFlattened(beforeAnn, lost, formAfter).problems.some((p) => /Ink/.test(p) && /missing/.test(p)));
  check("a dangling reference is reported", verifyFlattened(beforeAnn, { ...afterAnn, dangling: 1 }, formAfter).problems.some((p) => /dangling/i.test(p)));
  check("remaining form fields are reported", verifyFlattened(beforeAnn, afterAnn, await readFormFields(markup)).problems.some((p) => /field/i.test(p)));

  // Finding: pdf-lib's own flatten leaves dangling widget references (we prune them).
  const raw = await PDFDocument.load(markup);
  raw.getForm().flatten();
  const rawAnn = await inspectAnnotations(new Uint8Array(await raw.save()));
  console.log(`INFO  pdf-lib form.flatten() alone leaves ${rawAnn.dangling} dangling /Annots reference(s); flattenForm prunes them`);
  void PDFName;

  console.log(`\n=================================================`);
  console.log(failed ? `${failed} FLATTEN TESTS FAILED` : "ALL FLATTEN TESTS PASSED");
  console.log(`=================================================\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
