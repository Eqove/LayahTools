import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { EditorSession } from "../src/lib/pdf/editor/session";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
}

const wasm = () => { const b = fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm"); return new Uint8Array(b).buffer as ArrayBuffer; };
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;
const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join("tests", "fixtures", "pdfs", n)));

/** Reload bytes in a brand-new engine (independent of the session) and return page-0 info. */
async function independent(bytes: Uint8Array) {
  const e = new PdfEditorEngine();
  await e.initialize(wasm());
  await e.load(bytes);
  const texts = await e.getTextObjects(0);
  const images = await e.getImageObjects(0);
  const count = await e.getPageCount();
  e.dispose();
  return { texts, images, count };
}

async function main() {
  for (const name of process.argv[2] ? [process.argv[2]] : ["double coloumn sample.pdf", "single line sample.pdf", "SIH_AERES_PPT_FINAL.pdf"]) {
    console.log(`\n=== ${name} ===`);
    const s = new EditorSession();
    const t0 = Date.now();
    await s.open(fx(name), wasm());
    const pages = s.pageCount;
    check("opens + builds model", pages > 0, `${pages} pages in ${Date.now() - t0}ms`);

    // ids are stamped with the generation: after any undo/redo/edit re-read the page, or re-stamp with cur()
    const cur = (id: string) => id.replace(/@\d+$/, "@" + s.generation);
    let page = s.getPage(0);
    let runs = Object.values(page.layout.runs);
    const fresh = () => { page = s.getPage(0); runs = Object.values(page.layout.runs); };
    const sizeBefore = Object.keys(page.objects).length;
    if (!runs.length) { console.log("  (no text runs on page 0 — skipping text tests)"); }

    if (runs.length >= 1) {
      // --- move one run, verify bounds changed by delta via independent reload
      const r = runs[0];
      const b0 = r.bounds;
      const sel = await s.move(0, [r.id], 30, -20);
      const moved = s.getPage(0).layout.runs[sel[0]];
      check("move: selection survives reload", !!moved);
      check("move: bounds shifted by delta", !!moved && Math.abs(moved.bounds.left - b0.left - 30) < 0.5 && Math.abs(moved.bounds.bottom - b0.bottom + 20) < 0.5,
        moved ? `dx=${(moved.bounds.left - b0.left).toFixed(2)} dy=${(moved.bounds.bottom - b0.bottom).toFixed(2)}` : "");
      check("undo available", s.canUndo);
      await s.undo();
      const back = s.getPage(0).layout.runs[cur(r.id)];
      check("undo restores bounds", !!back && Math.abs(back.bounds.left - b0.left) < 0.01 && Math.abs(back.bounds.bottom - b0.bottom) < 0.01);
      await s.redo();
      check("redo reapplies move", s.canUndo && !s.canRedo);
      await s.undo();
      fresh();
    }

    if (runs.length >= 2) {
      // --- group move across derived runs resolves every source object
      const ids = runs.slice(0, 3).map(r => r.id);
      const srcIds = s.resolveSourceIds(0, ids);
      const expected = new Set(runs.slice(0, 3).flatMap(r => r.sourceObjectIds));
      check("group: resolves all underlying source objects", srcIds.length === expected.size, `${srcIds.length} sources`);
      const before = new Map(srcIds.map(id => [id, page.objects[id].bounds]));
      await s.move(0, ids, 15, 15);
      const p2 = s.getPage(0);
      const allMoved = srcIds.every(id => p2.objects[cur(id)] && Math.abs(p2.objects[cur(id)].bounds.left - before.get(id)!.left - 15) < 0.5);
      check("group: every source object moved", allMoved);
      await s.undo();
      fresh();
    }

    if (runs.length >= 1) {
      // --- block resolution
      const block = Object.values(page.layout.textBlocks)[0];
      if (block) {
        const viaBlock = s.resolveSourceIds(0, [block.id]);
        check("block resolves to source objects", viaBlock.length > 0, `${viaBlock.length}`);
      }
      // --- text replacement
      const r = runs.find(x => x.sourceObjectIds.length === 1) ?? runs[0];
      const newText = "LAYAH-EDIT-OK";
      let sel: string[] = [];
      let outcome = "in-font";
      try {
        sel = (await s.replaceText(0, r.id, newText)).ids;
      } catch (e: any) {
        outcome = e.name === "FontCoverageError" ? "rolled-back" : "ERROR " + e.message;
      }
      if (outcome === "rolled-back") {
        check("replaceText: lost glyphs detected, edit rolled back", !(await independent(s.bytes)).texts.some(t => t.text.includes("LAYAH")) && !s.canUndo);
        const r2 = await s.replaceText(0, r.id, newText, { substituteFont: true });
        sel = r2.ids;
        check("replaceText: Helvetica substitution succeeds", r2.substituted);
        outcome += "+substituted";
      }
      console.log("  replaceText outcome:", outcome);
      const text = (await independent(s.bytes)).texts.map(t => t.text).join("|");
      check("replaceText: visible in independent reload", text.includes(newText));
      check("replaceText: warning is produced", !!s.textEditWarning(0, sel[0] ?? r.id));
      await s.undo();
      const text2 = (await independent(s.bytes)).texts.map(t => t.text).join("|");
      check("replaceText: undo removes it", !text2.includes(newText));
      // --- delete
      const n0 = Object.keys(s.getPage(0).objects).length;
      await s.remove(0, [cur(r.id)]);
      const n1 = Object.keys(s.getPage(0).objects).length;
      check("delete removes object(s)", n1 < n0, `${n0} -> ${n1}`);
      await s.undo();
      check("undo delete restores count", Object.keys(s.getPage(0).objects).length === n0);
    }

    // --- add text
    const sel = await s.addText(0, { text: "New Text Box", x: 72, y: 72, fontSize: 18, fontFamily: "Helvetica", color: [200, 0, 0] });
    const ind = await independent(s.bytes);
    check("addText: present after independent reload", ind.texts.some(t => t.text.trim() === "New Text Box"));
    check("addText: returns selectable id", sel.length === 1 && !!s.getPage(0).layout.runs[sel[0]]);
    const newRun = s.getPage(0).layout.runs[sel[0]];
    const bT = newRun.bounds;
    const mv = await s.move(0, sel, 10, 10);
    check("addText: new text can be moved", Math.abs(s.getPage(0).layout.runs[mv[0]].bounds.left - bT.left - 10) < 0.5);
    const ed = (await s.replaceText(0, mv[0], "Edited New Text")).ids;
    check("addText: new text can be edited", (await independent(s.bytes)).texts.some(t => t.text.trim() === "Edited New Text") && ed.length === 1);

    // --- add image (4x4 gradient), resize
    const px = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) { px[i * 4] = i * 16; px[i * 4 + 1] = 80; px[i * 4 + 2] = 200; px[i * 4 + 3] = 255; }
    const imgBefore = (await independent(s.bytes)).images.length;
    const isel = await s.addImage(0, { rgba: px, pixelWidth: 4, pixelHeight: 4, x: 100, y: 100, width: 120, height: 80 });
    const after = await independent(s.bytes);
    check("addImage: image object exists in exported PDF", after.images.length === imgBefore + 1);
    const im = s.getPage(0).objects[isel[0]];
    check("addImage: selectable + correct bounds", !!im && Math.abs(im.bounds.right - im.bounds.left - 120) < 0.5 && Math.abs(im.bounds.top - im.bounds.bottom - 80) < 0.5,
      im ? JSON.stringify(im.bounds) : "no object");
    if (im) {
      const rs = await s.resize(0, isel[0], { left: 100, bottom: 100, right: 160, top: 140 });
      const im2 = s.getPage(0).objects[rs[0]];
      check("resize: image resized", !!im2 && Math.abs(im2.bounds.right - im2.bounds.left - 60) < 0.5 && Math.abs(im2.bounds.top - im2.bounds.bottom - 40) < 0.5);
    }

    // --- rect
    await s.addRect(0, { x: 50, y: 400, width: 100, height: 40, fill: [255, 200, 0], stroke: [0, 0, 0], strokeWidth: 2 });
    check("addRect: exported without error", s.bytes.length > 0);

    // --- reopen with pdf-lib (independent parser) + page count preserved
    const lib = await PDFDocument.load(s.bytes);
    check("exported PDF reopens in pdf-lib", lib.getPageCount() === pages);

    // --- failure rollback: stale / bogus id must not corrupt state
    const bytesBefore = s.bytes, genBefore = s.generation;
    let code = "";
    try { await s.move(0, [`page-0-text-99999@${s.generation}`], 1, 1); } catch (e: any) { code = e.code; }
    check("bogus id rejected (STALE_ID), document untouched", code === "STALE_ID" && same(s.bytes, bytesBefore) && s.generation === genBefore);

    // --- stale pointer guard: after delete in one commit, same id isn't reusable
    const gen = s.generation;
    await s.undo();
    check("generation bumps on reload", s.generation > gen);
    await s.dispose();
  }

  console.log("\n=== multi-document isolation ===");
  const A = new EditorSession(), B = new EditorSession();
  await A.open(fx("double coloumn sample.pdf"), wasm());
  await B.open(fx("single line sample.pdf"), wasm());
  const bBytes = B.bytes, bGen = B.generation;
  const runA = Object.values(A.getPage(0).layout.runs)[0];
  // reading the model / resolving selection must not reload or change anything
  const aGen = A.generation, aBytes = A.bytes;
  A.layoutIdsFor(0, A.resolveSourceIds(0, [runA.id]));
  A.textEditWarning(0, runA.id);
  check("selection helpers don't reload or mutate", A.generation === aGen && same(A.bytes, aBytes) && !A.canUndo);
  await A.move(0, [runA.id], 20, 20);
  check("editing A leaves B untouched", same(B.bytes, bBytes) && B.generation === bGen && !B.canUndo);
  await A.undo();
  check("undo in A doesn't affect B", same(B.bytes, bBytes) && !B.canRedo);
  const runB = Object.values(B.getPage(0).layout.runs)[0];
  await B.remove(0, [runB.id]);
  check("A history independent of B edits", !A.canUndo && A.canRedo);
  const objsBefore = Object.keys(A.getPage(0).objects).length;
  await A.addText(0, { text: "one", x: 50, y: 50, fontSize: 12 });
  await A.addText(0, { text: "two", x: 50, y: 80, fontSize: 12 });
  await A.move(0, [Object.values(A.getPage(0).layout.runs)[0].id], 5, 5);
  await A.undo(); await A.undo(); await A.undo();
  check("three sequential edits undo back to original object count", Object.keys(A.getPage(0).objects).length === objsBefore && !A.canUndo);
  await A.dispose(); await B.dispose();

  console.log("\n=== error handling ===");
  const bad = new EditorSession();
  let msg = "";
  try { await bad.open(new Uint8Array([1, 2, 3, 4]), wasm()); } catch (e: any) { msg = e.message; }
  check("malformed PDF gives friendly error", /could not be opened|password/.test(msg), msg);

  const enc = await PDFDocument.create();
  enc.addPage([200, 200]);
  // pdf-lib can't encrypt; password path is covered by the error-code branch and checked manually.

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
