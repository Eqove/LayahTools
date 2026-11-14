import { detectRepeatedElements, RepeatedElement } from "../src/lib/interpretation/repeated-elements";
import { groupIntoLines } from "../src/lib/interpretation/text-lines";
import type { PageText, TextItem } from "../src/lib/interpretation/types";
import { loadPageTexts } from "./lib/pdf-text-pages";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
}

// ---- synthetic builders (PDF space: bottom-left origin, points) ----
const W = 595;
const H = 842;
function item(text: string, x: number, y: number, size = 10): TextItem {
  return { text, bounds: { left: x, bottom: y, right: x + text.length * size * 0.5, top: y + size } };
}
function page(pageIndex: number, items: TextItem[], width = W, height = H): PageText {
  return { pageIndex, width, height, items };
}
/** deterministic pseudo-jitter in [-amp, amp] */
const jit = (i: number, amp: number) => ((((i * 7919) % 13) / 12) * 2 - 1) * amp;
const body = (i: number): TextItem[] => [
  item(`Unique body line A on page ${i} lorem ipsum`, 50, 600),
  item(`Different body line B on page ${i} dolor sit`, 50, 580),
  item(`Third body line C on page ${i} amet`, 50, 560),
];
const kinds = (r: RepeatedElement[], k: string) => r.filter((e) => e.kind === k);

// =============== 1. empty / malformed ===============
check("empty document -> []", detectRepeatedElements([]).length === 0);
check("non-array input -> []", detectRepeatedElements(undefined as any).length === 0 && detectRepeatedElements(null as any).length === 0);
check("single page can never be repeated", detectRepeatedElements([page(0, [item("ACME", 50, 800), item("1", 290, 30)])]).length === 0);
{
  const bad: PageText[] = [0, 1, 2, 3].map((i) =>
    page(i, [
      item("ACME Corp", 50 + jit(i, 1), 800),
      { text: "NaN item", bounds: { left: NaN, bottom: 0, right: 1, top: 1 } },
      { text: 42 as any, bounds: { left: 0, bottom: 0, right: 1, top: 1 } },
      { text: "   ", bounds: { left: 0, bottom: 800, right: 10, top: 810 } },
      null as any,
      { text: "no bounds" } as any,
    ])
  );
  const r = detectRepeatedElements(bad);
  check("malformed items are skipped, valid header still found", r.length === 1 && r[0].kind === "HEADER" && r[0].text === "ACME Corp");
}
{
  const r = detectRepeatedElements([
    { pageIndex: 0, width: 0, height: 0, items: [item("ACME", 50, 800)] },
    { pageIndex: 1, width: NaN as any, height: H, items: [item("ACME", 50, 800)] },
    null as any,
  ]);
  check("pages without usable size are ignored (no throw)", r.length === 0);
}

// =============== 2. repeated headers ===============
const headerDoc = [0, 1, 2, 3, 4].map((i) => page(i, [item("ACME Corp Confidential", 50 + jit(i, 2), 800 + jit(i + 3, 1.5)), ...body(i)]));
{
  const r = detectRepeatedElements(headerDoc);
  check("repeated header: exactly one element", r.length === 1, JSON.stringify(r.map((e) => e.kind)));
  const h = r[0];
  check("repeated header: HEADER with text", h?.kind === "HEADER" && h.text === "ACME Corp Confidential");
  check("repeated header: pages 0..4", JSON.stringify(h?.pageIndexes) === "[0,1,2,3,4]");
  check("repeated header: bounding box near top, covers jitter", !!h && h.bounds.bottom > 790 && h.bounds.top < 815 && h.bounds.left <= 48.5);
  check("repeated header: high confidence", !!h && h.confidence >= 0.9 && h.confidence <= 1, String(h?.confidence));
  check("repeated header: one occurrence per page", h?.occurrences.length === 5 && h.occurrences[2].pageIndex === 2);
  check("body text never classified", r.every((e) => !/body line/i.test(e.text)));
}

// =============== 3. repeated footers ===============
{
  const doc = [0, 1, 2, 3].map((i) => page(i, [item("Acme Report 2026", 50 + jit(i, 1.5), 30 + jit(i, 1)), ...body(i)]));
  const r = detectRepeatedElements(doc);
  check("repeated footer: FOOTER", r.length === 1 && r[0].kind === "FOOTER" && r[0].text === "Acme Report 2026" && r[0].pageIndexes.length === 4);
}
{
  const doc = [0, 1, 2, 3].map((i) => page(i, [item("Acme | Page " + (i + 1), 50, 30), ...body(i)]));
  const r = detectRepeatedElements(doc);
  check("footer with embedded page number is one FOOTER", r.length === 1 && r[0].kind === "FOOTER" && r[0].pageIndexes.length === 4, JSON.stringify(r.map((e) => e.text)));
}

// =============== 4. page numbering ===============
const pn = (fmt: (n: number) => string, n = 6, x = 290, y = 30) => Array.from({ length: n }, (_, i) => page(i, [item(fmt(i + 1), x, y), ...body(i)]));
{
  for (const [label, fmt] of [
    ["bare digits", (n: number) => String(n)],
    ["'Page n'", (n: number) => `Page ${n}`],
    ["'n of 6'", (n: number) => `${n} of 6`],
    ["'n / 6'", (n: number) => `${n} / 6`],
    ["'- n -'", (n: number) => `- ${n} -`],
  ] as [string, (n: number) => string][]) {
    const r = detectRepeatedElements(pn(fmt));
    const p = kinds(r, "PAGE_NUMBER");
    check(`page number (${label})`, r.length === 1 && p.length === 1 && p[0].pageIndexes.length === 6 && JSON.stringify(p[0].values) === "[1,2,3,4,5,6]", JSON.stringify(r.map((e) => [e.kind, e.text])));
  }
  const roman = detectRepeatedElements(pn((n) => ["i", "ii", "iii", "iv", "v", "vi"][n - 1]));
  check("page number (roman numerals)", kinds(roman, "PAGE_NUMBER").length === 1 && JSON.stringify(roman[0].values) === "[1,2,3,4,5,6]");
  const top = detectRepeatedElements(pn((n) => String(n), 6, 500, 810));
  check("page number at top right is still PAGE_NUMBER", top.length === 1 && top[0].kind === "PAGE_NUMBER");
  const same = detectRepeatedElements(pn(() => "1"));
  check("constant '1' on every page is not a page number", kinds(same, "PAGE_NUMBER").length === 0);
  const wobble = detectRepeatedElements(
    Array.from({ length: 6 }, (_, i) => page(i, [item(String(i + 1), i % 2 ? 292 : 288, 30 + (i % 3)), ...body(i)]))
  );
  check("page number tolerates small position wobble", wobble.length === 1 && wobble[0].kind === "PAGE_NUMBER" && wobble[0].pageIndexes.length === 6);
  const sparse = detectRepeatedElements(
    [0, 1, 2, 3, 4, 5].map((i) => page(i, [...(i === 0 ? [] : [item(String(i + 1), 290, 30)]), ...body(i)]))
  );
  check("title page without number: numbers on pages 1..5", sparse.length === 1 && JSON.stringify(sparse[0].values) === "[2,3,4,5,6]" && sparse[0].pageIndexes[0] === 1);
  const withHeader = detectRepeatedElements(
    pn((n) => `Page ${n}`).map((p, i) => ({ ...p, items: [...p.items, item("ACME Corp Confidential", 50, 800)] }))
  );
  check("header + page number are reported separately", kinds(withHeader, "HEADER").length === 1 && kinds(withHeader, "PAGE_NUMBER").length === 1 && withHeader.length === 2);
}

// =============== 5. different headers on different sections ===============
{
  const doc = [0, 1, 2, 3, 4, 5].map((i) => page(i, [item(i < 3 ? "Chapter One: Origins" : "Chapter Two: Growth", 50, 800), ...body(i)]));
  const r = detectRepeatedElements(doc);
  const h = kinds(r, "HEADER");
  check("two section headers -> two HEADER elements", h.length === 2, JSON.stringify(h.map((e) => e.text)));
  check("section headers keep their own pages", JSON.stringify(h.find((e) => /One/.test(e.text))?.pageIndexes) === "[0,1,2]" && JSON.stringify(h.find((e) => /Two/.test(e.text))?.pageIndexes) === "[3,4,5]");
}
{
  const names = ["Intro", "Method", "Results"];
  const doc = Array.from({ length: 9 }, (_, i) => page(i, [item(`Section ${names[Math.floor(i / 3)]}`, 50, 800), ...body(i)]));
  const h = kinds(detectRepeatedElements(doc), "HEADER");
  check("three 3-page sections are all found (run rule)", h.length === 3 && h.every((e) => e.pageIndexes.length === 3));
}

// =============== 6. missing headers ===============
{
  const doc = [0, 1, 2, 3, 4, 5].map((i) => page(i, [...(i === 0 || i === 3 ? [] : [item("ACME Corp Confidential", 50, 800)]), ...body(i)]));
  const r = detectRepeatedElements(doc);
  check("headers missing on 2 of 6 pages still detected", r.length === 1 && JSON.stringify(r[0].pageIndexes) === "[1,2,4,5]");
  const full = detectRepeatedElements(headerDoc)[0];
  check("missing headers lower confidence", r[0].confidence < full.confidence && r[0].confidence > 0.5, `${r[0].confidence} < ${full.confidence}`);
}
{
  const doc = [0, 1, 2, 3, 4, 5].map((i) => page(i, [...(i === 2 ? [item("ACME Corp Confidential", 50, 800)] : []), ...body(i)]));
  check("header on only one page is not repeated", detectRepeatedElements(doc).length === 0);
}

// =============== 7. similar but non-identical text ===============
{
  const doc = [0, 1, 2, 3].map((i) => page(i, [item(`Quarterly Report Q${i + 1}`, 50, 800), ...body(i)]));
  check("similar-but-different headers are not merged", detectRepeatedElements(doc).length === 0);
}
{
  const doc = [0, 1, 2, 3, 4, 5].map((i) => page(i, [item(i < 4 ? "Acme Corp" : "Acme Corp Ltd", 50, 800), ...body(i)]));
  const r = detectRepeatedElements(doc);
  check("only exact matches cluster (4 of 6)", r.length === 1 && r[0].text === "Acme Corp" && r[0].pageIndexes.length === 4);
}
{
  const doc = [0, 1, 2, 3].map((i) => page(i, [item(i % 2 ? "ACME   Corp" : "Acme Corp", 50, 800), ...body(i)]));
  const r = detectRepeatedElements(doc);
  check("case and whitespace differences are normalised", r.length === 1 && r[0].pageIndexes.length === 4);
}

// =============== 8. multi-column ===============
{
  const col = (i: number): TextItem[] => [
    item("Shared sentence repeated in both columns", 50, 500),
    item("Shared sentence repeated in both columns", 320, 500),
    item(`left col unique ${i}`, 50, 480),
    item(`right col unique ${i}`, 320, 480),
  ];
  const doc = [0, 1, 2, 3].map((i) => page(i, [item("Left Running Head", 50, 800), item("Right Running Head", 320, 800), item(String(i + 1), 295, 30), ...col(i)]));
  const r = detectRepeatedElements(doc);
  const h = kinds(r, "HEADER");
  check("multi-column: left and right running heads are separate HEADERs", h.length === 2 && h.some((e) => e.text === "Left Running Head") && h.some((e) => e.text === "Right Running Head"), JSON.stringify(h.map((e) => e.text)));
  check("multi-column: page number found", kinds(r, "PAGE_NUMBER").length === 1);
  check("multi-column: repeated body text in both columns not classified", r.length === 3 && r.every((e) => !/Shared sentence/.test(e.text)));
}

// =============== 9. repeated body text is not a header/footer ===============
{
  const doc = [0, 1, 2, 3, 4].map((i) => page(i, [item("Confidential - do not distribute", 50, 400), item("Note repeated near margin zone", 50, 150), ...body(i)]));
  check("repeated mid-page text is ignored", detectRepeatedElements(doc).length === 0);
}
{
  const doc = [0, 1, 2, 3, 4].map((i) => page(i, [item("ACME", 50 + i * 90, 800), ...body(i)]));
  check("same text at wildly different positions is not a header", detectRepeatedElements(doc).length === 0);
}

// =============== 10. options, determinism, immutability ===============
{
  const doc = [0, 1, 2, 3].map((i) => page(i, [item("Low Running Head", 50, 700), ...body(i)]));
  check("default band excludes text at 83% of page height", detectRepeatedElements(doc).length === 0);
  const wide = detectRepeatedElements(doc, { bandRatio: 0.25 });
  check("bandRatio option widens the header band", wide.length === 1 && wide[0].kind === "HEADER");
}
{
  const before = JSON.stringify(headerDoc);
  const a = detectRepeatedElements(headerDoc);
  const b = detectRepeatedElements(headerDoc);
  check("input is not mutated", JSON.stringify(headerDoc) === before);
  check("deterministic: identical output on repeat", JSON.stringify(a) === JSON.stringify(b));
  const shuffled = [...headerDoc].reverse().map((p) => ({ ...p, items: [...p.items].reverse() }));
  check("deterministic: page and item order does not matter", JSON.stringify(detectRepeatedElements(shuffled)) === JSON.stringify(a));
}
{
  const doc = Array.from({ length: 40 }, (_, i) => page(i, [item("Handbook", 50, 800), item(`Page ${i + 1} of 40`, 280, 30), ...body(i)]));
  const r = detectRepeatedElements(doc);
  check("multi-page (40): one header, one page number", r.length === 2 && kinds(r, "HEADER")[0].pageIndexes.length === 40 && kinds(r, "PAGE_NUMBER")[0].values!.length === 40);
}

// =============== 11. groupIntoLines (shared helper) ===============
{
  const lines = groupIntoLines([item("world", 90, 100.5), item("hello", 50, 100), item("below", 50, 80)]);
  check("lines: same baseline merged left-to-right, top-to-bottom order", lines.length === 2 && lines[0].text === "hello world" && lines[1].text === "below");
  const cols = groupIntoLines([item("left", 50, 100), item("right", 320, 100)]);
  check("lines: far-apart items on one baseline are split (columns)", cols.length === 2 && cols[0].text === "left" && cols[1].text === "right");
  check("lines: invalid input is skipped", groupIntoLines([null as any, { text: "x" } as any, item("ok", 1, 1)]).length === 1 && groupIntoLines(undefined as any).length === 0);
}

// =============== 12. real corpus PDFs (text read through PDFium) ===============
async function realPdfs() {
  const dir = "tests/fixtures/pdf-corpus/";
  const long = await loadPageTexts(dir + "long-document.pdf");
  const r = detectRepeatedElements(long);
  // verified against the file: every page has "Page i of 25" at ~(271,38) and a per-section title that differs by page
  check("long-document.pdf: exactly one element", r.length === 1, JSON.stringify(r.map((e) => [e.kind, e.text])));
  check("long-document.pdf: PAGE_NUMBER 1..25", r[0]?.kind === "PAGE_NUMBER" && JSON.stringify(r[0].values) === JSON.stringify(Array.from({ length: 25 }, (_, i) => i + 1)));
  check("long-document.pdf: 'Section n' titles are not headers", r.every((e) => e.kind !== "HEADER"));

  // verified by inspecting the band text: no running header/footer/page number exists in this paper sample
  const mc = await loadPageTexts(dir + "multi-column.pdf");
  check("multi-column.pdf: no false positives from dense two-column body", detectRepeatedElements(mc).length === 0);
  check("multi-column.pdf: deterministic", JSON.stringify(detectRepeatedElements(mc)) === JSON.stringify(detectRepeatedElements(mc)));

  for (const f of ["simple-text.pdf", "table-heavy.pdf", "scanned-image-only.pdf"]) {
    const pages = await loadPageTexts(dir + f);
    check(`${f}: no repeated elements`, detectRepeatedElements(pages).length === 0);
  }
  // empty document: a real 1-page PDF without text and a zero-item multi-page list
  check("pages with no text -> []", detectRepeatedElements([page(0, []), page(1, []), page(2, [])]).length === 0);
}

realPdfs()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    console.log(failed ? `\n${failed} FAILED` : "\nALL REPEATED-ELEMENT TESTS PASSED");
    process.exit(failed ? 1 : 0);
  });
