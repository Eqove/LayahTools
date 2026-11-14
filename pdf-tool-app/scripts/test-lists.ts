import { PDFDocument, StandardFonts } from "pdf-lib";
import { detectLists, detectListsInPages, DetectedList } from "../src/lib/interpretation/lists";
import type { PageText, TextItem } from "../src/lib/interpretation/types";
import { loadPageTexts, loadPageTextsFromBytes } from "./lib/pdf-text-pages";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
}

// ---- synthetic builders (PDF space, points). 10pt text, 5pt per char ----
function item(text: string, x: number, y: number, size = 10): TextItem {
  return { text, bounds: { left: x, bottom: y, right: x + text.length * size * 0.5, top: y + size } };
}
/** marker and text as two separate text objects (how many PDFs emit lists) */
const mk = (marker: string, text: string, x: number, y: number, indent = Math.max(14, marker.length * 5 + 6)): TextItem[] => [item(marker, x, y), item(text, x + indent, y)];
/** marker glued into one text object */
const glued = (marker: string, text: string, x: number, y: number): TextItem[] => [item(`${marker} ${text}`, x, y)];
/** a column of list lines, `pitch` points apart, starting at y0 going down */
const col = (markers: string[], x: number, y0: number, pitch = 14, label = "Item text") =>
  markers.flatMap((m, i) => mk(m, `${label} ${i + 1}`, x, y0 - i * pitch));
const texts = (l: DetectedList) => l.items.map((i) => i.text);
const markers = (l: DetectedList) => l.items.map((i) => i.marker);

// =============== 1. empty / malformed ===============
check("empty -> []", detectLists([]).length === 0);
check("non-array -> []", detectLists(undefined as any).length === 0 && detectLists(null as any).length === 0);
check("malformed items skipped", detectLists([null as any, { text: "1. x" } as any, { text: 5 as any, bounds: { left: 0, bottom: 0, right: 1, top: 1 } }, item("• ok", NaN, 5)]).length === 0);
check("marker-only lines (no text) are not items", detectLists([item("•", 50, 700), item("•", 50, 686), item("•", 50, 672)]).length === 0);

// =============== 2. bullets ===============
{
  const r = detectLists(col(["•", "•", "•", "•"], 50, 700));
  const l = r[0];
  check("bullets (separate marker objects): one list, type bullet", r.length === 1 && l.type === "bullet", JSON.stringify(r.map((x) => x.type)));
  check("bullets: 4 items, text without marker", l?.items.length === 4 && texts(l)[0] === "Item text 1" && texts(l)[3] === "Item text 4");
  check("bullets: order 0..3, level 0, marker kept", l.items.every((it, i) => it.order === i && it.level === 0 && it.marker === "•" && it.markerType === "bullet"));
  check("bullets: item bounds cover marker + text", l.items[0].bounds.left === 50 && l.items[0].bounds.right > 100 && l.items[0].bounds.top === 710);
  check("bullets: list bounds = union", l.bounds.top === 710 && l.bounds.bottom === 658 && l.bounds.left === 50);
  check("bullets: confidence high", l.confidence >= 0.8 && l.confidence <= 1, String(l.confidence));
}
{
  const glue = detectLists([...glued("•", "alpha", 50, 700), ...glued("•", "beta", 50, 686), ...glued("•", "gamma", 50, 672)]);
  check("bullets (glued marker)", glue.length === 1 && glue[0].type === "bullet" && JSON.stringify(texts(glue[0])) === '["alpha","beta","gamma"]');
  const hy = detectLists([...glued("-", "alpha", 50, 700), ...glued("-", "beta", 50, 686)]);
  check("hyphen bullets (lower confidence than •)", hy.length === 1 && hy[0].type === "bullet" && hy[0].confidence < glue[0].confidence, `${hy[0]?.confidence} < ${glue[0].confidence}`);
  const dash = detectLists([...glued("–", "alpha", 50, 700), ...glued("–", "beta", 50, 686)]);
  check("en-dash bullets", dash.length === 1 && dash[0].type === "bullet");
  const pua = detectLists([...glued("", "alpha", 50, 700), ...glued("", "beta", 50, 686)]);
  check("symbol-font private-use bullet glyph (U+F0B7)", pua.length === 1 && pua[0].type === "bullet");
  const mixed = detectLists([...glued("•", "alpha", 50, 700), ...glued("◦", "beta", 50, 686), ...glued("▪", "gamma", 50, 672)]);
  check("different bullet glyphs at one indent stay one list", mixed.length === 1 && mixed[0].items.length === 3);
  const star = detectLists([...glued("*", "alpha", 50, 700), ...glued("*", "beta", 50, 686)]);
  check("asterisk bullets", star.length === 1 && star[0].type === "bullet");
}

// =============== 3. numbered ===============
for (const [label, ms] of [
  ["1. 2. 3.", ["1.", "2.", "3."]],
  ["1) 2) 3)", ["1)", "2)", "3)"]],
  ["(1) (2) (3)", ["(1)", "(2)", "(3)"]],
] as [string, string[]][]) {
  const r = detectLists(col(ms, 50, 700));
  check(`numbered ${label}`, r.length === 1 && r[0].type === "numbered" && r[0].items.length === 3 && JSON.stringify(r[0].items.map((i) => i.value)) === "[1,2,3]" && JSON.stringify(markers(r[0])) === JSON.stringify(ms), JSON.stringify(r.map((x) => x.type)));
}
{
  const r = detectLists([...glued("1.", "Plan", 50, 700), ...glued("2.", "Build", 50, 686), ...glued("10.", "Ship", 50, 672)]);
  check("numbered glued markers, multi-digit", r.length === 1 && r[0].items.length === 3 && r[0].items[2].value === 10);
}

// =============== 4. alphabetical / roman ===============
{
  for (const [label, ms] of [["a. b. c.", ["a.", "b.", "c."]], ["A) B) C)", ["A)", "B)", "C)"]], ["(a) (b) (c)", ["(a)", "(b)", "(c)"]]] as [string, string[]][]) {
    const r = detectLists(col(ms, 50, 700));
    check(`alphabetical ${label}`, r.length === 1 && r[0].type === "alpha" && JSON.stringify(r[0].items.map((i) => i.value)) === "[1,2,3]", JSON.stringify(r.map((x) => x.type)));
  }
  for (const [label, ms] of [["i. ii. iii. iv.", ["i.", "ii.", "iii.", "iv."]], ["I. II. III.", ["I.", "II.", "III."]], ["(i) (ii) (iii)", ["(i)", "(ii)", "(iii)"]]] as [string, string[]][]) {
    const r = detectLists(col(ms, 50, 700));
    check(`roman ${label}`, r.length === 1 && r[0].type === "roman" && r[0].items[1].value === 2, JSON.stringify(r.map((x) => x.type)));
  }
  const hij = detectLists(col(["h.", "i.", "j."], 50, 700));
  check("ambiguous 'i.' between h. and j. is alphabetical", hij.length === 1 && hij[0].type === "alpha" && hij[0].items[1].value === 9);
  const cde = detectLists(col(["c.", "d.", "e."], 50, 700));
  check("c. d. e. are letters, not roman numerals", cde.length === 1 && cde[0].type === "alpha");
  const iiii = detectLists(col(["i.", "ii.", "iii."], 50, 700));
  check("i. ii. iii. is roman (i. resolved by what follows)", iiii[0].type === "roman" && iiii[0].items[0].markerType === "roman");
  const bad = detectLists(col(["iiii.", "iiiii."], 50, 700));
  check("non-canonical roman 'iiii.' is not a marker", bad.length === 0);
}

// =============== 5. nested lists + indentation grouping ===============
{
  const items = [
    ...mk("1.", "Parent A", 50, 700),
    ...mk("•", "child one", 70, 686),
    ...mk("•", "child two", 70, 672),
    ...mk("2.", "Parent B", 50, 658),
    ...mk("•", "child three", 70, 644),
  ];
  const r = detectLists(items);
  const l = r[0];
  check("nested: one list, 5 items in reading order", r.length === 1 && l.items.length === 5 && JSON.stringify(texts(l)) === '["Parent A","child one","child two","Parent B","child three"]', JSON.stringify(r.map((x) => x.items.length)));
  check("nested: levels 0,1,1,0,1", JSON.stringify(l.items.map((i) => i.level)) === "[0,1,1,0,1]");
  check("nested: list type is the top level's, items keep their own markerType", l.type === "numbered" && l.items[1].markerType === "bullet" && l.items[3].value === 2);
  check("nested: order is sequential", JSON.stringify(l.items.map((i) => i.order)) === "[0,1,2,3,4]");
}
{
  const items = [
    ...mk("1.", "L0", 50, 700),
    ...mk("a.", "L1", 70, 686),
    ...mk("i.", "L2", 90, 672),
    ...mk("ii.", "L2 again", 90, 658),
    ...mk("b.", "L1 again", 70, 644),
    ...mk("2.", "L0 again", 50, 630),
  ];
  const l = detectLists(items)[0];
  check("3 levels with return to shallower levels", !!l && JSON.stringify(l.items.map((i) => i.level)) === "[0,1,2,2,1,0]", JSON.stringify(l?.items.map((i) => i.level)));
  check("3 levels: per-level types (numbered > alpha > roman)", l.items[1].markerType === "alpha" && l.items[2].markerType === "roman" && l.items[3].markerType === "roman");
}
{
  const items = [
    ...mk("1.", "P1", 50, 700),
    ...mk("a.", "first sub", 70, 686),
    ...mk("b.", "second sub", 70, 672),
    ...mk("2.", "P2", 50, 658),
    ...mk("a.", "restarted sub", 70, 644),
    ...mk("b.", "second again", 70, 630),
  ];
  const l = detectLists(items);
  check("nested sublists restart under each parent", l.length === 1 && l[0].items.length === 6 && JSON.stringify(l[0].items.map((i) => i.level)) === "[0,1,1,0,1,1]");
}
{
  const jitter = [0, 3, -2, 2, -3];
  const items = jitter.flatMap((j, i) => mk("•", `top ${i}`, 50 + j, 700 - i * 14).concat([]));
  const r = detectLists(items);
  check("indentation jitter (±3pt) stays level 0", r.length === 1 && r[0].items.every((i) => i.level === 0));
  const mixed = [
    ...mk("•", "base 1", 50, 700),
    ...mk("•", "base 2", 52, 686),
    ...mk("•", "deeper 1", 68, 672),
    ...mk("•", "deeper 2", 71, 658),
    ...mk("•", "base 3", 49, 644),
  ];
  const m = detectLists(mixed)[0];
  check("indent clusters: 50±3 vs 70±3 -> levels 0/1", JSON.stringify(m.items.map((i) => i.level)) === "[0,0,1,1,0]", JSON.stringify(m?.items.map((i) => i.level)));
}

// =============== 6. spacing ===============
{
  const ys = [700, 684, 662, 632, 600]; // pitches 16, 22, 30, 32 (box gap <= 22)
  const items = ys.flatMap((y, i) => mk("•", `loose ${i}`, 50, y));
  const r = detectLists(items);
  check("inconsistent (growing) spacing stays one list", r.length === 1 && r[0].items.length === 5, JSON.stringify(r.map((x) => x.items.length)));
  const split = detectLists([...col(["•", "•"], 50, 700), ...col(["•", "•"], 50, 600)]);
  check("a large vertical gap starts a new list", split.length === 2 && split[0].items.length === 2 && split[1].items.length === 2);
  const joined = detectLists([...col(["•", "•"], 50, 700), ...col(["•", "•"], 50, 600)], { maxItemGapRatio: 8 });
  check("maxItemGapRatio option can join them", joined.length === 1 && joined[0].items.length === 4);
}

// =============== 7. missing numbers ===============
{
  const full = detectLists(col(["1.", "2.", "3.", "4."], 50, 700))[0];
  const gap = detectLists(col(["1.", "2.", "4.", "5."], 50, 700));
  check("missing number (1,2,4,5): still one list", gap.length === 1 && gap[0].items.length === 4);
  check("missing number is reported", JSON.stringify(gap[0]?.missingValues) === "[3]", JSON.stringify(gap[0]?.missingValues));
  check("missing number lowers confidence", gap[0].confidence < full.confidence, `${gap[0].confidence} < ${full.confidence}`);
  check("complete list reports no missing values", (full.missingValues ?? []).length === 0);
  const late = detectLists(col(["3.", "4.", "5."], 50, 700));
  check("list starting at 3 is accepted with lower confidence", late.length === 1 && late[0].confidence < full.confidence);
  const lateA = detectLists(col(["c.", "d.", "e."], 50, 700));
  const startA = detectLists(col(["a.", "b.", "c."], 50, 700));
  check("alpha list not starting at 'a' is less confident", lateA[0].confidence < startA[0].confidence);
}

// =============== 8. wrapped items ===============
{
  const items = [
    item("1.", 50, 700), item("First item with long text that wraps", 64, 700), item("onto a second line", 64, 688),
    item("2.", 50, 670), item("Second item wraps twice", 64, 670), item("onto line two", 64, 658), item("and line three", 64, 646),
    item("3.", 50, 628), item("Third is short", 64, 628),
  ];
  const l = detectLists(items)[0];
  check("wrapped lines are joined into their item", !!l && l.items.length === 3 && l.items[0].text === "First item with long text that wraps onto a second line" && l.items[1].text.endsWith("and line three"), JSON.stringify(l && texts(l)));
  check("wrapped: lineCount and bounds cover all lines", l.items[0].lineCount === 2 && l.items[1].lineCount === 3 && l.items[1].bounds.bottom === 646 && l.items[2].lineCount === 1);
  const para = detectLists([...items, item("This paragraph follows the list and starts flush left.", 50, 600)])[0];
  check("flush-left paragraph after the list is not absorbed", para.items.length === 3 && !para.items.some((i) => /paragraph/.test(i.text)));
  const glueWrap = detectLists([...glued("•", "Bullet text that wraps", 50, 700), item("wrapped part", 57, 688), ...glued("•", "Next", 50, 674)])[0];
  check("wrap aligned to glued-marker text start", glueWrap.items.length === 2 && glueWrap.items[0].text === "Bullet text that wraps wrapped part", JSON.stringify(glueWrap?.items.map((i) => i.text)));
}

// =============== 9. multiple lists / restarts ===============
{
  const items = [
    ...col(["1.", "2.", "3."], 50, 700),
    item("A paragraph of ordinary prose separates the two lists.", 50, 640),
    ...col(["•", "•"], 50, 600),
  ];
  const r = detectLists(items);
  check("two lists on one page (numbered, then bullets)", r.length === 2 && r[0].type === "numbered" && r[1].type === "bullet" && r[0].items.length === 3 && r[1].items.length === 2);
  check("lists are returned top-to-bottom", r[0].bounds.top > r[1].bounds.top);
  const restart = detectLists([...col(["1.", "2.", "3."], 50, 700), ...col(["1.", "2."], 50, 658)]);
  check("numbering restart (1,2,3 then 1,2) starts a new list", restart.length === 2 && restart[0].items.length === 3 && restart[1].items.length === 2, JSON.stringify(restart.map((x) => x.items.length)));
  const swap = detectLists([...col(["1.", "2."], 50, 700), ...col(["•", "•"], 50, 672)]);
  check("changing list type at the same indent starts a new list", swap.length === 2 && swap[0].type === "numbered" && swap[1].type === "bullet");
}

// =============== 10. false positives ===============
{
  const prose = [
    item("The quick brown fox jumps over the lazy dog and keeps running.", 50, 700),
    item("A second sentence continues the paragraph with more words here.", 50, 688),
    item("Well-known facts - like this one - contain dashes mid-line.", 50, 676),
  ];
  check("ordinary paragraph is not a list", detectLists(prose).length === 0);
  check("year at line start ('2020. The company ...') is not a marker", detectLists([...glued("2020.", "The company grew", 50, 700), ...glued("2021.", "It grew again", 50, 686)]).length === 0);
  check("lone numbered line is not a list", detectLists([...glued("1.", "Only item here", 50, 700), item("Normal text after it.", 50, 686)]).length === 0);
  check("lone bullet is not a list", detectLists(glued("•", "Only bullet", 50, 700)).length === 0);
  check("initial 'A. Smith wrote this' is not a list", detectLists([...glued("A.", "Smith wrote this", 50, 700), item("Then more prose follows it on the next line.", 50, 686)]).length === 0);
  check("decreasing numbers (3. 2. 1.) are not a list", detectLists(col(["3.", "2.", "1."], 50, 700)).length === 0);
  check("same number repeated is not a list", detectLists(col(["1.", "1.", "1."], 50, 700)).length === 0);
  check("numbered lines far apart in prose are not a list", detectLists([...glued("1.", "first mention", 50, 700), ...glued("2.", "second mention", 50, 560)]).length === 0);
  check("section numbers (1.1 Intro) are not list markers", detectLists([...glued("1.1", "Scope", 50, 700), ...glued("1.2", "Purpose", 50, 686)]).length === 0);
  check("table-like rows are not lists", detectLists([item("Q1", 50, 700), item("$250,000", 150, 700), item("Q2", 50, 686), item("$500,000", 150, 686)]).length === 0);
  check("lone hyphen decoration is not a list", detectLists([item("-", 50, 700), item("-", 50, 600)]).length === 0);
}

// =============== 11. multi-column ===============
{
  const left = col(["1.", "2.", "3."], 50, 700, 14, "Left item");
  const rightProse = [0, 1, 2].map((i) => item(`Right column prose line number ${i}`, 320, 700 - i * 14));
  const r = detectLists([...left, ...rightProse]);
  check("multi-column: right-column prose does not break the left list", r.length === 1 && r[0].items.length === 3 && r[0].bounds.right < 300, JSON.stringify(r.map((x) => x.items.length)));
  const both = detectLists([...left, ...col(["•", "•", "•"], 320, 700, 14, "Right item")]);
  check("multi-column: independent lists in each column", both.length === 2 && both.map((l) => l.type).sort().join() === "bullet,numbered" && both.every((l) => l.items.length === 3));
  const interleaved = detectLists([...left, ...rightProse, ...col(["•", "•"], 320, 650, 14, "Right later")]);
  check("multi-column: prose then list in the right column", interleaved.length === 2);
}

// =============== 12. determinism, immutability, pages ===============
{
  const items = [...col(["1.", "2.", "3."], 50, 700), ...mk("•", "child", 70, 658), ...mk("•", "child 2", 70, 644)];
  const before = JSON.stringify(items);
  const a = detectLists(items);
  check("input not mutated", JSON.stringify(items) === before);
  check("deterministic on repeat", JSON.stringify(a) === JSON.stringify(detectLists(items)));
  check("deterministic when item order is shuffled", JSON.stringify(a) === JSON.stringify(detectLists([...items].reverse())));
}
{
  const pages: PageText[] = [0, 1, 2].map((i) => ({ pageIndex: i, width: 595, height: 842, items: i === 1 ? [] : col(["•", "•", "•"], 50, 700) }));
  const r = detectListsInPages(pages);
  check("detectListsInPages: multi-page, empty page skipped, pageIndex set", r.length === 2 && r[0].pageIndex === 0 && r[1].pageIndex === 2);
  check("detectListsInPages: empty/malformed", detectListsInPages([]).length === 0 && detectListsInPages(undefined as any).length === 0 && detectListsInPages([null as any]).length === 0);
}

// =============== 13. real PDFs (text read through PDFium) ===============
async function realPdfs() {
  const mc = await loadPageTexts("tests/fixtures/pdf-corpus/multi-column.pdf");
  const byPage = mc.map((p) => detectLists(p.items));
  // verified by inspection of the page: four "•" lines at x=75 (multi-column layout / footnotes / page and column floats / multi-level counters)
  const l = byPage[1][0];
  check("multi-column.pdf p2: the real 4-item bullet list is found", byPage[1].length === 1 && l.type === "bullet" && l.items.length === 4, JSON.stringify(byPage.map((x) => x.length)));
  check("multi-column.pdf p2: item text", !!l && JSON.stringify(texts(l)) === JSON.stringify(["multi-column layout", "footnotes", "page and column floats", "multi-level counters"]), JSON.stringify(l && texts(l)));
  check("multi-column.pdf p1/p3: no false-positive lists", byPage[0].length === 0 && byPage[2].length === 0, JSON.stringify(byPage.map((x) => x.length)));

  for (const f of ["tests/fixtures/pdf-corpus/long-document.pdf", "tests/fixtures/pdf-corpus/simple-text.pdf", "tests/fixtures/pdf-corpus/table-heavy.pdf", "tests/fixtures/pdfs/single line sample.pdf", "tests/fixtures/pdfs/SIH_AERES_PPT_FINAL.pdf"]) {
    const pages = await loadPageTexts(f);
    const r = detectListsInPages(pages);
    check(`${f.split("/").pop()}: no false-positive lists (${pages.length} pages)`, r.length === 0, JSON.stringify(r.map((x) => [x.pageIndex, x.items.length])));
  }

  // a PDF generated here, read back through PDFium: end-to-end bounds and text
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pg = doc.addPage([595, 842]);
  const lines: [string, number, number][] = [
    ["Scope of work", 50, 780],
    ["1. Baseline", 50, 750], ["2. Validation", 50, 735], ["3. Gate A", 50, 720],
    ["- unit tests", 70, 705], ["- build", 70, 690],
    ["Closing paragraph of ordinary prose text.", 50, 660],
  ];
  for (const [t, x, y] of lines) pg.drawText(t, { x, y, size: 11, font });
  const gen = detectLists((await loadPageTextsFromBytes(await doc.save()))[0].items);
  check("generated PDF via PDFium: numbered list with nested bullets", gen.length === 1 && gen[0].type === "numbered" && JSON.stringify(gen[0].items.map((i) => i.level)) === "[0,0,0,1,1]", JSON.stringify(gen.map((x) => x.items.map((i) => [i.text, i.level]))));
  check("generated PDF: heading and closing paragraph excluded", !!gen[0] && !gen[0].items.some((i) => /Scope|Closing/.test(i.text)));
}

realPdfs()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    console.log(failed ? `\n${failed} FAILED` : "\nALL LIST-DETECTION TESTS PASSED");
    process.exit(failed ? 1 : 0);
  });
