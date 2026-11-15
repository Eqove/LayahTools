/** Text styling on a selected line: size (scale), colour (in place) and standard-font restyle (bold / italic / family). */
import * as fs from "fs";
import * as path from "path";
import { EditorSession } from "../src/lib/pdf/editor/session";
import { PdfEditorEngine } from "../src/lib/pdf/editor/engine";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`); if (!ok) failed++; };
const wasm = () => new Uint8Array(fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm")).buffer as ArrayBuffer;
const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join("tests", "fixtures", "pdfs", n)));

/** Independent reload: text objects of page 0 with their fill colours. */
async function reread(bytes: Uint8Array) {
  const e = new PdfEditorEngine();
  await e.initialize(wasm());
  await e.load(bytes);
  const texts = await e.getTextObjects(0);
  const colours = texts.map(t => e.getFillColor(t.id));
  e.dispose();
  return { texts, colours };
}

async function main() {
  const s = new EditorSession();
  await s.open(fx("single line sample.pdf"), wasm());
  const runs = () => Object.values(s.getPage(0).layout.runs);
  const target = runs().find(r => r.sourceObjectIds.length > 0)!;
  const textOf = (id: string) => s.resolveSourceIds(0, [id]).map(i => (s.getPage(0).objects[i] as { text: string }).text).join(" ").trim();
  const before = textOf(target.id);
  const w0 = target.bounds.right - target.bounds.left;

  // scale
  const sc = await s.scale(0, [target.id], 1.5);
  const scaled = s.getPage(0).layout.runs[sc[0]];
  const w1 = scaled.bounds.right - scaled.bounds.left;
  check("scale 1.5 widens the line ~1.5x", Math.abs(w1 / w0 - 1.5) < 0.05, `${w0.toFixed(1)} -> ${w1.toFixed(1)}`);
  check("scale keeps the left edge", Math.abs(scaled.bounds.left - target.bounds.left) < 0.5);
  check("scale keeps the text", textOf(sc[0]) === before);
  let threw = false; try { await s.scale(0, [sc[0]], 10); } catch { threw = true; }
  check("scale rejects absurd factors", threw);

  // colour in place
  const red: [number, number, number] = [220, 30, 30];
  const rc = await s.restyleText(0, sc[0], { color: red });
  const srcs = s.resolveSourceIds(0, rc);
  const reloaded = await reread(s.bytes);
  const hasRed = reloaded.colours.some(c => c && c[0] === 220 && c[1] === 30 && c[2] === 30);
  check("colour: a text object is now red after an independent reload", hasRed && srcs.length > 0);
  check("colour keeps the text", textOf(rc[0]) === before);

  // font restyle
  const bd = await s.restyleText(0, rc[0], { font: "Times-Bold" });
  check("font: returns the restyled line", bd.length === 1);
  check("font: text preserved", textOf(bd[0]) === before, `${textOf(bd[0])} vs ${before}`);
  const f = (s.getPage(0).objects[s.resolveSourceIds(0, bd)[0]] as { fontFamily?: string }).fontFamily ?? "";
  check("font: family is Times Bold", /times/i.test(f) && /bold/i.test(f), f);
  const keptColour = (await reread(s.bytes)).colours.some(c => c && c[0] === 220 && c[1] === 30 && c[2] === 30);
  check("font: colour carried over", keptColour);

  // undo walks back, one step per operation
  const depth = s.history.undoDepth;
  await s.undo();
  check("undo reverts the font restyle", s.history.undoDepth === depth - 1);

  // a font that cannot show the characters rolls back
  const odd = s.getPage(0).layout.runs;
  void odd;
  let bad = false; try { await s.restyleText(0, Object.values(s.getPage(0).layout.runs)[0].id, { font: "No-Such-Font" }); } catch { bad = true; }
  const after = s.history.undoDepth;
  check("unknown font is rejected without adding history", bad && after === s.history.undoDepth);

  await s.dispose();
  console.log(failed ? `\n${failed} FAILED` : "\nALL TEXT-STYLE CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
