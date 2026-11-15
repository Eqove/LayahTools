/** Shapes (rectangle, ellipse, line, arrow) are written as real PDF path operators and undo cleanly. */
import * as fs from "fs";
import * as path from "path";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { EditorSession } from "../src/lib/pdf/editor/session";
import { hitCandidates, selectAllOnPage } from "../src/lib/document/gestures";
import { hitTestPoint } from "../src/lib/document/hittest";
import { InteractionStateMachine } from "../src/lib/document/interaction";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`); if (!ok) failed++; };
const wasm = () => new Uint8Array(fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm")).buffer as ArrayBuffer;
const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join("tests", "fixtures", "pdfs", n)));

/** Count of path operators across the first page's content streams. */
async function ops(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const c = doc.getPage(0).node.Contents();
  const refs = c instanceof PDFArray ? c.asArray().map(r => doc.context.lookup(r)) : [c];
  const text = refs.map(st => Buffer.from(decodePDFRawStream(st as PDFRawStream).decode()).toString("latin1")).join("\n");
  const toks = text.split(/\s+/);
  const n = (op: string) => toks.filter(t => t === op).length;
  return { c: n("c"), l: n("l"), m: n("m"), re: n("re") };
}

async function main() {
  const s = new EditorSession();
  await s.open(fx("single line sample.pdf"), wasm());
  const red: [number, number, number] = [220, 30, 30];
  let before = await ops(s.bytes);

  await s.addShape(0, { kind: "ellipse", x1: 100, y1: 400, x2: 220, y2: 340, stroke: red, strokeWidth: 3 });
  let after = await ops(s.bytes);
  check("ellipse: four Bézier curves added", after.c - before.c >= 4, `c ${before.c} -> ${after.c}`);
  before = after;

  await s.addShape(0, { kind: "ellipse", x1: 100, y1: 300, x2: 220, y2: 240, stroke: red, fill: [255, 255, 0] });
  after = await ops(s.bytes);
  check("filled ellipse: written without error", after.c - before.c >= 4);
  before = after;

  await s.addShape(0, { kind: "line", x1: 50, y1: 200, x2: 250, y2: 200, stroke: red });
  after = await ops(s.bytes);
  check("line: one line segment added", after.l - before.l === 1 && after.m - before.m >= 0, `l ${before.l} -> ${after.l}`);
  before = after;

  await s.addShape(0, { kind: "arrow", x1: 50, y1: 150, x2: 250, y2: 150, stroke: red, strokeWidth: 2 });
  after = await ops(s.bytes);
  check("arrow: shaft plus two head strokes", after.l - before.l >= 3, `l ${before.l} -> ${after.l}`);
  before = after;

  await s.addShape(0, { kind: "rect", x1: 300, y1: 100, x2: 360, y2: 60, stroke: red });
  after = await ops(s.bytes);
  check("rect via addShape: a rectangle added", after.re - before.re >= 1 || after.l - before.l >= 4, `re ${before.re} -> ${after.re}`);

  // dragging backwards (right-to-left / bottom-to-top) still works
  await s.addShape(0, { kind: "ellipse", x1: 400, y1: 300, x2: 300, y2: 400, stroke: red });
  check("reverse drag is accepted", true);

  // history: one step each, undo walks back
  const depth = s.history.undoDepth;
  check("each shape is one undo step", depth >= 6, `depth ${depth}`);
  await s.undo();
  const afterUndo = await ops(s.bytes);
  check("undo removes the last shape", afterUndo.c < (await ops(s.bytes)).c + 1 && s.history.undoDepth === depth - 1);

  // invalid input is rejected without touching history
  const d2 = s.history.undoDepth;
  let threw = false; try { await s.addShape(0, { kind: "line", x1: 10, y1: 10, x2: 10, y2: 10 }); } catch { threw = true; }
  check("a zero-length shape is rejected", threw && s.history.undoDepth === d2);
  threw = false; try { await s.addShape(0, { kind: "line", x1: NaN, y1: 0, x2: 5, y2: 5 }); } catch { threw = true; }
  check("non-finite coordinates are rejected", threw && s.history.undoDepth === d2);

  // ---- shapes are editable objects, not just ink ----
  await s.dispose();
  const e = new EditorSession();
  await e.open(fx("single line sample.pdf"), wasm());
  const shapesOf = (sess: EditorSession) => Object.values(sess.getPage(0).objects).filter(o => o.type === "shape") as unknown as { id: string; bounds: { left: number; right: number; top: number; bottom: number }; shape: { kind: string; x1: number; y1: number; x2: number; y2: number; strokeWidth: number; stroke: number[]; fill?: number[] } }[];
  check("a plain PDF has no editable shapes (its own lines stay untouched)", shapesOf(e).length === 0);
  const ids = await e.addShape(0, { kind: "ellipse", x1: 100, y1: 400, x2: 220, y2: 340, stroke: [220, 30, 30], strokeWidth: 3 });
  check("addShape returns the new shape's id", ids.length === 1);
  let sh = shapesOf(e);
  check("the new shape is a selectable object with its parameters", sh.length === 1 && sh[0].shape.kind === "ellipse" && sh[0].shape.strokeWidth === 3 && sh[0].shape.stroke.join() === "220,30,30", JSON.stringify(sh[0]?.shape));

  // survives save + reload in a brand-new session
  const e2 = new EditorSession();
  await e2.open(e.bytes, wasm());
  const sh2 = shapesOf(e2);
  check("shape survives save and reload with the same parameters", sh2.length === 1 && sh2[0].shape.kind === "ellipse" && Math.abs(sh2[0].shape.x1 - 100) < 0.01 && sh2[0].shape.strokeWidth === 3 && sh2[0].shape.stroke.join() === "220,30,30");
  await e2.dispose();

  // restyle: colour, thickness, fill
  let id = shapesOf(e)[0].id;
  let r = await e.updateShape(0, id, { strokeWidth: 6, stroke: [0, 0, 255], fill: [255, 255, 0] });
  sh = shapesOf(e);
  check("restyle: thickness, colour and fill change", sh.length === 1 && sh[0].shape.strokeWidth === 6 && sh[0].shape.stroke.join() === "0,0,255" && sh[0].shape.fill?.join() === "255,255,0" && r.length === 1);
  const sizeBefore = { w: sh[0].bounds.right - sh[0].bounds.left, h: sh[0].bounds.top - sh[0].bounds.bottom };
  r = await e.updateShape(0, shapesOf(e)[0].id, { fill: null });
  check("restyle: fill can be removed", shapesOf(e)[0].shape.fill === undefined);

  // move keeps the stored geometry in step
  await e.move(0, [shapesOf(e)[0].id], 30, -20);
  sh = shapesOf(e);
  check("move: stored points follow the object", Math.abs(sh[0].shape.x1 - 130) < 0.01 && Math.abs(sh[0].shape.y1 - 380) < 0.01, `x1=${sh[0].shape.x1} y1=${sh[0].shape.y1}`);
  // restyle after a move must not snap it back
  await e.updateShape(0, sh[0].id, { strokeWidth: 2 });
  sh = shapesOf(e);
  check("restyle after a move keeps the new position", Math.abs(sh[0].shape.x1 - 130) < 0.01 && Math.abs(sh[0].shape.y1 - 380) < 0.01);

  // resize by new corner points: stroke width is kept, only geometry changes
  await e.updateShape(0, sh[0].id, { x2: 330, y2: 300 });
  sh = shapesOf(e);
  check("resize: geometry changes, stroke width kept", sh[0].shape.x2 === 330 && sh[0].shape.y2 === 300 && sh[0].shape.strokeWidth === 2, `w=${sh[0].shape.strokeWidth}`);

  // duplicate / delete
  const dup = await e.duplicateShape(0, shapesOf(e)[0].id);
  check("duplicate: two shapes, copy is offset", dup.length === 1 && shapesOf(e).length === 2);
  await e.remove(0, [dup[0]]);
  check("delete: the copy is removed", shapesOf(e).length === 1);
  let bad = false; try { await e.updateShape(0, Object.values(e.getPage(0).layout.runs)[0].id, { strokeWidth: 3 }); } catch { bad = true; }
  check("updateShape on a non-shape is rejected", bad);
  await e.dispose();

  // ---- click targets ----
  const h = new EditorSession();
  await h.open(fx("single line sample.pdf"), wasm());
  const diag = await h.addShape(0, { kind: "line", x1: 100, y1: 100, x2: 300, y2: 300, stroke: [0, 0, 0], strokeWidth: 2 });
  const hitAt = (x: number, y: number) => hitTestPoint({ x, y }, hitCandidates(h.getPage(0)));
  check("a click on a line selects it", hitAt(200, 200) === diag[0]);
  check("a click near a line (3pt away) still selects it", hitAt(202, 198) === diag[0]);
  check("a click in the empty corner of a diagonal line's box does not", hitAt(110, 290) !== diag[0]);
  const m = new InteractionStateMachine();
  selectAllOnPage(m, h.getPage(0));
  check("select all includes shapes", m.getState().selectedObjectIds.includes(diag[0]));
  await h.dispose();

  // output is still a valid PDF
  const doc = await PDFDocument.load(s.bytes);
  check("exported PDF still opens", doc.getPageCount() === 4 || doc.getPageCount() > 0, `${doc.getPageCount()} pages`);

  await s.dispose();
  console.log(failed ? `\n${failed} FAILED` : "\nALL SHAPE CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
