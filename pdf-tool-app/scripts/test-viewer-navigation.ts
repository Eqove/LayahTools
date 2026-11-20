/**
 * Viewer navigation (smart zoom + temporary pan) regression tests.
 * - Pure zoom math, fit modes and cursor anchoring against a model of the viewer's scroll layout.
 * - PanController semantics (middle drag, Space + drag, Space release, Escape, cancel, lost capture, blur, Hand tool).
 * - Zoom backdrop rules (no blank frame while react-pdf re-renders; superseded renders never remove it).
 * - Integration with a real EditorSession: every pointer event is routed exactly as in the viewer (PanController
 *   claims first, otherwise the page overlay's gesture seam). Navigation must never select, marquee, move or mutate;
 *   normal selection and dragging must keep working at every zoom.
 */
import * as fs from "fs";
import * as path from "path";
import { EditorSession } from "../src/lib/pdf/editor/session";
import { InteractionStateMachine } from "../src/lib/document/interaction";
import { hitTestPoint } from "../src/lib/document/hittest";
import { pdfToViewportPoint, viewportToPdfPoint, PageCoordinateContext } from "../src/lib/document/coordinates";
import { gestureDown, gestureMove, gestureUp, gestureCancel, hitCandidates } from "../src/lib/document/gestures";
import { PanController, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, anchoredScroll, clampZoom, fitZoom, fractionIn, isCurrentRender, keepBackdrop, wheelZoom, type Rect } from "../src/lib/viewer/navigation";
import { instrumentSession } from "./lib/mutation-probe";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
  if (!ok) failed++;
};
const wasm = () => new Uint8Array(fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm")).buffer as ArrayBuffer;
const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join("tests", "fixtures", "pdfs", n)));

// ---------------------------------------------------------------------------------------------------------------
// A model of PdfViewer's scroll layout: padding 32/16, pages in a column with 24px gaps, the column at least as wide
// as the view and as wide as the widest page (pages centred in it), the browser clamping scroll to its range.
// ---------------------------------------------------------------------------------------------------------------
const PAD_T = 32, PAD_X = 16, GAP = 24, PAD_B = 96;
class ViewModel {
  scroll = { left: 0, top: 0 };
  constructor(public pages: { w: number; h: number }[], public view = { width: 719, height: 584 }, public zoom = 1) {}
  private inner() { return this.view.width - 2 * PAD_X; }
  private colWidth() { return Math.max(this.inner(), ...this.pages.map(p => Math.floor(p.w * this.zoom))); }
  /** Page rect in client coordinates (view's top-left = 0,0). */
  rect(i: number): Rect {
    let top = PAD_T;
    for (let k = 0; k < i; k++) top += Math.floor(this.pages[k].h * this.zoom) + GAP;
    const w = Math.floor(this.pages[i].w * this.zoom), h = Math.floor(this.pages[i].h * this.zoom);
    const left = PAD_X + (this.colWidth() - w) / 2;
    return { left: left - this.scroll.left, top: top - this.scroll.top, width: w, height: h };
  }
  private max() {
    const contentH = PAD_T + this.pages.reduce((s, p) => s + Math.floor(p.h * this.zoom), 0) + GAP * (this.pages.length - 1) + PAD_B;
    return { left: Math.max(0, PAD_X + this.colWidth() - this.view.width), top: Math.max(0, contentH - this.view.height) };
  }
  setScroll(s: { left: number; top: number }) {
    const m = this.max();
    this.scroll = { left: Math.min(m.left, Math.max(0, Math.round(s.left))), top: Math.min(m.top, Math.max(0, Math.round(s.top))) };
  }
  pageAt(p: { x: number; y: number }) {
    let best = 0, bestD = Infinity;
    this.pages.forEach((_, i) => { const r = this.rect(i); const d = p.y < r.top ? r.top - p.y : p.y > r.top + r.height ? p.y - r.top - r.height : 0; if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  /** Exactly what PdfViewer.zoomTo + its layout effect do. Returns whether the scroll had to be clamped. */
  zoomTo(z: number, p: { x: number; y: number }) {
    const i = this.pageAt(p), f = fractionIn(p, this.rect(i));
    this.zoom = clampZoom(z);
    const want = anchoredScroll(this.scroll, p, this.rect(i), f);
    this.setScroll(want);
    return Math.abs(this.scroll.left - want.left) > 1 || Math.abs(this.scroll.top - want.top) > 1;
  }
  /** Document point (page index + PDF-ish units at zoom 1) under a client point. */
  docAt(p: { x: number; y: number }, i: number) { const r = this.rect(i); return { x: (p.x - r.left) / this.zoom, y: (p.y - r.top) / this.zoom }; }
}

function zoomMath() {
  console.log("== zoom math");
  check("Ctrl+wheel up (negative deltaY) zooms in", wheelZoom(1, -100) > 1.1 && wheelZoom(1, -100) < 1.25, String(wheelZoom(1, -100)));
  check("Ctrl+wheel down zooms out", wheelZoom(1, 100) < 0.9 && wheelZoom(1, 100) > 0.8, String(wheelZoom(1, 100)));
  check("in then out returns to (about) the same zoom", Math.abs(wheelZoom(wheelZoom(1.5, -100), 100) - 1.5) < 0.01);
  check("small pinch deltas give small steps", Math.abs(wheelZoom(1, -4) - 1) < 0.01 && wheelZoom(1, -4) > 1);
  check("line-mode deltas are normalised (3 lines ~ one notch)", Math.abs(wheelZoom(1, -3, 1) - wheelZoom(1, -48)) < 1e-9);
  check("runaway deltas are capped at one notch", wheelZoom(1, -5000) === wheelZoom(1, -100));
  let z = 1; for (let i = 0; i < 60; i++) z = wheelZoom(z, -100);
  check(`zoom never exceeds ${ZOOM_MAX * 100}%`, z === ZOOM_MAX);
  for (let i = 0; i < 80; i++) z = wheelZoom(z, 100);
  check(`zoom never goes below ${ZOOM_MIN * 100}%`, z === ZOOM_MIN);
  check("+/- steps stay inside the limits", clampZoom(ZOOM_MAX + ZOOM_STEP) === ZOOM_MAX && clampZoom(ZOOM_MIN - ZOOM_STEP) === ZOOM_MIN && clampZoom(1 + ZOOM_STEP) === 1.25);

  const view = { width: 687, height: 520 };
  for (const [name, page] of [["Letter portrait", { width: 612, height: 792 }], ["A4 portrait", { width: 595, height: 842 }], ["16:9 slide", { width: 960, height: 540 }], ["tall receipt", { width: 226, height: 1600 }]] as const) {
    const w = fitZoom("width", page, view), p = fitZoom("page", page, view);
    check(`Fit Width (${name}) makes the page exactly the view width`, Math.abs(page.width * w - view.width) < 1 || w === ZOOM_MAX || w === ZOOM_MIN, `${w}`);
    check(`Fit Page (${name}) fits both dimensions, touching one`, (page.width * p <= view.width + 0.5 && page.height * p <= view.height + 0.5 && (Math.abs(page.width * p - view.width) < 1 || Math.abs(page.height * p - view.height) < 1)) || p === ZOOM_MIN, `${p}`);
  }
}

function anchoring() {
  console.log("\n== cursor-anchored zoom (viewer layout model)");
  const docs: [string, { w: number; h: number }[]][] = [
    ["3 Letter pages", [{ w: 612, h: 792 }, { w: 612, h: 792 }, { w: 612, h: 792 }]],
    ["mixed sizes", [{ w: 960, h: 540 }, { w: 595, h: 842 }, { w: 960, h: 540 }]],
  ];
  for (const [name, pages] of docs) {
    for (const start of [0.5, 1, 2]) {
      const v = new ViewModel(pages, undefined, start);
      v.setScroll({ left: 1e6, top: 300 }); // scrolled away from the edges where possible
      v.setScroll({ left: v.scroll.left / 2, top: 300 });
      let worst = 0, n = 0, clamped = 0;
      for (const p of [{ x: 360, y: 290 }, { x: 150, y: 120 }, { x: 600, y: 480 }]) {
        for (const dy of [-100, -100, -40, 100, -100, 100, 100, -4]) {
          const i = v.pageAt(p), before = v.docAt(p, i);
          if (v.zoomTo(wheelZoom(v.zoom, dy), p)) { clamped++; continue; }
          const after = v.docAt(p, i);
          worst = Math.max(worst, Math.hypot(after.x - before.x, after.y - before.y) * v.zoom);
          n++;
        }
      }
      check(`${name} from ${start * 100}%: the point under the cursor stays put (in-range steps)`, n > 0 && worst <= 1.5, `worst ${worst.toFixed(2)}px over ${n} steps, ${clamped} clamped at the scroll range`);
    }
  }
  const v = new ViewModel([{ w: 612, h: 792 }, { w: 612, h: 792 }]);
  v.setScroll({ left: 0, top: 400 });
  const top0 = v.scroll.top;
  v.zoomTo(v.zoom, { x: 300, y: 300 });
  check("re-applying the same zoom does not move the scroll position", v.scroll.top === top0);
  v.zoomTo(1.5, { x: 344, y: 292 });
  check("zooming in mid-document keeps the view inside the document (no reset to the top)", v.scroll.top > top0);
}

function panning() {
  console.log("\n== pan controller");
  const P = (x: number, y: number) => ({ x, y });
  let pan = new PanController();
  check("plain left press is not claimed (Select keeps it)", pan.down(1, 0, P(0, 0)) === false && pan.phase === "idle");
  check("right press is not claimed", pan.down(1, 2, P(0, 0)) === false);
  check("middle press is claimed", pan.down(1, 1, P(100, 100)) === true && pan.phase === "panning");
  const d = pan.drag(1, P(70, 120));
  check("pan scrolls opposite to the pointer (content follows the hand)", !!d && d.x === 30 && d.y === -20);
  check("moves of another pointer are ignored", pan.drag(2, P(0, 0)) === null);
  check("a second button during a pan is swallowed", pan.down(3, 0, P(0, 0)) === true && pan.phase === "panning");
  check("middle release ends the pan and is swallowed", pan.up(1) === true && pan.phase === "idle" && !pan.owns(1));

  pan = new PanController();
  check("Space keydown is handled", pan.keyDown(" ") && pan.spaceHeld);
  check("Space + left press is claimed", pan.down(5, 0, P(10, 10)) === true);
  pan.drag(5, P(20, 30));
  check("releasing Space mid-pan ends the pan", pan.keyUp(" ") && pan.phase === "inert" && !pan.spaceHeld);
  check("after Space release further moves do not scroll", pan.drag(5, P(200, 200)) === null);
  check("...and the release is still swallowed (no selection, no click)", pan.up(5) === true && pan.phase === "idle");
  check("next left press without Space goes to Select again", pan.down(6, 0, P(0, 0)) === false);

  pan = new PanController();
  pan.keyDown(" "); pan.down(7, 1, P(0, 0)); pan.keyUp(" ");
  check("releasing Space does not end a middle-button pan", pan.phase === "panning");
  check("Escape ends an active pan and reports it (so the key is swallowed)", pan.escape() === true && pan.phase === "inert" && pan.drag(7, P(9, 9)) === null);
  check("...release afterwards is swallowed", pan.up(7) === true);
  check("Escape with no pan is not swallowed (editor Escape keeps working)", pan.escape() === false);

  pan = new PanController();
  pan.down(8, 1, P(0, 0));
  pan.cancel(99);
  check("cancel for another pointer is ignored", pan.phase === "panning");
  pan.cancel(8);
  check("pointercancel / lostpointercapture ends the pan immediately", pan.phase === "idle" && pan.drag(8, P(5, 5)) === null && pan.up(8) === false);
  pan.keyDown(" "); pan.down(9, 0, P(0, 0)); pan.blur();
  check("window blur clears Space and any pan (keyup may never arrive)", !pan.spaceHeld && pan.phase === "idle" && pan.down(10, 0, P(0, 0)) === false);

  console.log("\n== Hand tool");
  pan = new PanController();
  pan.hand = true;
  check("Hand: plain left press is claimed as a pan", pan.down(11, 0, P(0, 0)) === true && pan.phase === "panning");
  const hd = pan.drag(11, P(-40, 25));
  check("Hand: left drag scrolls with the pointer", !!hd && hd.x === 40 && hd.y === -25);
  check("Hand: release ends the pan and is swallowed", pan.up(11) === true && pan.phase === "idle");
  check("Hand stays active for the next press (no auto-switch back)", pan.down(12, 0, P(0, 0)) === true); pan.up(12);
  pan.keyDown(" "); pan.down(13, 0, P(0, 0)); pan.keyUp(" ");
  check("Hand: releasing Space does not end a Hand drag", pan.phase === "panning"); pan.up(13);
  check("Hand: Escape still ends a drag", pan.down(14, 0, P(0, 0)) && pan.escape() && pan.phase === "inert"); pan.up(14);
  check("Hand: right press is still not claimed", pan.down(15, 2, P(0, 0)) === false);
  pan.hand = false;
  check("back to Select: plain left press goes to the overlay again", pan.down(16, 0, P(0, 0)) === false);
}

function zoomBackdrop() {
  console.log("\n== Zoom backdrop (flicker)");
  check("an on-screen page with a finished render gets a backdrop", keepBackdrop({ canvasRendered: true, hasBackdrop: false, onScreen: true }));
  check("a page mid-render (blank, hidden canvas) is not copied: the older backdrop is kept", !keepBackdrop({ canvasRendered: false, hasBackdrop: true, onScreen: true }));
  check("a second zoom during a render keeps the existing backdrop (no blank frame copied over it)", !keepBackdrop({ canvasRendered: false, hasBackdrop: true, onScreen: true }) && !keepBackdrop({ canvasRendered: true, hasBackdrop: true, onScreen: true }));
  check("off-screen pages get no backdrop (bounded canvas memory)", !keepBackdrop({ canvasRendered: true, hasBackdrop: false, onScreen: false }));
  check("a render at the current zoom removes the backdrop", isCurrentRender(1.25, 1.25) && isCurrentRender(1.2499999, 1.25));
  check("a render at a superseded zoom does not remove it", !isCurrentRender(1, 1.25) && !isCurrentRender(1.5, 1.25));
}

/** Routes events exactly like PdfViewer (capture phase: pan first) + EditorPageOverlay (gesture seam). */
class Router {
  machine = new InteractionStateMachine();
  pan = new PanController();
  tool = "select";
  scroll = { x: 0, y: 0 };
  private nextId = 1;
  private id = 0;
  constructor(public s: EditorSession, public pageIndex: number, public zoom: number) {}
  get page() { return this.s.getPage(this.pageIndex); }
  get ctx(): PageCoordinateContext { return { width: this.page.width, height: this.page.height, zoom: this.zoom, rotation: 0 }; }
  /** Client point of a PDF point given the current scroll. */
  client(x: number, y: number) { const v = pdfToViewportPoint({ x, y }, this.ctx); return { x: v.x + 40 - this.scroll.x, y: v.y + 60 - this.scroll.y }; }
  private pdf(c: { x: number; y: number }) { return viewportToPdfPoint({ x: c.x - 40 + this.scroll.x, y: c.y - 60 + this.scroll.y }, this.ctx); }
  down(c: { x: number; y: number }, button = 0, shift = false) {
    this.id = this.nextId++;
    if (this.pan.down(this.id, button, c)) return "pan";
    if (this.tool === "hand") return "ignored"; // EditorPageOverlay returns early in the Hand tool
    gestureDown(this.machine, this.page, this.pdf(c), shift);
    return "overlay";
  }
  move(c: { x: number; y: number }) {
    if (this.pan.owns(this.id)) { const d = this.pan.drag(this.id, c); if (d) { this.scroll.x += d.x; this.scroll.y += d.y; } return; }
    gestureMove(this.machine, this.pageIndex, this.pdf(c), this.zoom);
  }
  async up(shift = false) {
    if (this.pan.up(this.id)) return null;
    const intent = gestureUp(this.machine, this.page, shift, this.zoom);
    if (intent?.type === "move") await this.s.move(this.pageIndex, intent.objectIds, intent.deltaX, intent.deltaY);
    return intent;
  }
  cancel() { if (this.pan.owns(this.id)) { this.pan.cancel(this.id); return; } gestureCancel(this.machine, this.pageIndex); }
}

function runCentres(s: EditorSession, pageIndex: number, n: number) {
  const page = s.getPage(pageIndex);
  const out: { id: string; x: number; y: number }[] = [];
  for (const r of Object.values(page.layout.runs)) {
    const x = (r.bounds.left + r.bounds.right) / 2, y = (r.bounds.bottom + r.bounds.top) / 2;
    if (hitTestPoint({ x, y }, hitCandidates(page)) === r.id) out.push({ id: r.id, x, y });
    if (out.length === n) break;
  }
  return out;
}

async function editorIntegration() {
  for (const name of ["double coloumn sample.pdf", "SIH_AERES_PPT_FINAL.pdf"]) {
    console.log(`\n== navigation inside the editor: ${name}`);
    const s = new EditorSession();
    await s.open(fx(name), wasm());
    const probe = instrumentSession(s);
    const [a, b] = runCentres(s, 0, 2);
    check("fixture has two hittable runs", !!a && !!b);
    for (const zoom of [0.5, 1, 2, 4]) {
      const r = new Router(s, 0, zoom);
      const at = r.client(a.x, a.y);
      let sel: string[] = [];
      let problem = "";
      try { await probe.assertUnchanged(`zoom ${zoom * 100}%`, async () => {
        // middle-button drag starting on a run
        if (r.down(at, 1) !== "pan") throw new Error("middle press not claimed");
        for (let i = 1; i <= 6; i++) r.move({ x: at.x + 15 * i, y: at.y - 9 * i });
        if (await r.up() !== null) throw new Error("middle release produced an intent");
        if (r.machine.getState().selectedObjectIds.length) throw new Error("middle pan selected something");
        // Space + left drag starting on a run (would otherwise be an object drag)
        r.pan.keyDown(" ");
        const at2 = r.client(a.x, a.y);
        if (r.down(at2) !== "pan") throw new Error("space press not claimed");
        for (let i = 1; i <= 6; i++) r.move({ x: at2.x - 20 * i, y: at2.y + 12 * i });
        await r.up();
        // Space + drag from empty space (would otherwise be a marquee)
        r.down({ x: 5, y: 5 }); r.move({ x: 400, y: 400 }); await r.up();
        r.pan.keyUp(" ");
        if (r.machine.getState().selectedObjectIds.length || r.machine.getState().phase !== "idle") throw new Error("space pan changed the selection or left a gesture");
        // Space released mid-pan: the rest of the press is inert
        r.pan.keyDown(" "); const at3 = r.client(a.x, a.y); r.down(at3); r.move({ x: at3.x + 30, y: at3.y }); r.pan.keyUp(" ");
        r.move({ x: at3.x + 200, y: at3.y + 100 });
        if (await r.up() !== null || r.machine.getState().selectedObjectIds.length) throw new Error("press continued as a selection after Space release");
        // Escape and pointer cancel mid-pan
        const at4 = r.client(a.x, a.y); r.down(at4, 1); r.move({ x: at4.x + 50, y: at4.y }); r.pan.escape(); r.move({ x: at4.x + 300, y: at4.y }); await r.up();
        const at5 = r.client(a.x, a.y); r.down(at5, 1); r.move({ x: at5.x + 50, y: at5.y }); r.cancel(); r.move({ x: at5.x + 300, y: at5.y });
        if (r.machine.getState().phase !== "idle" || r.pan.phase !== "idle") throw new Error("escape/cancel left a gesture behind");
        // after all that panning, a normal click selects the run under the cursor (scroll is accounted for)
        const c = r.client(a.x, a.y); r.down(c); await r.up();
        sel = [...r.machine.getState().selectedObjectIds];
        // zooming in between is navigation too: the tool stays Select
        r.zoom = clampZoom(wheelZoom(r.zoom, -100));
      }); } catch (e) { problem = (e as Error).message; }
      check(`zoom ${zoom * 100}%: pans (middle, Space, Space-release, Escape, cancel) made no mutation, export, reload, generation or history change`, !problem, problem);
      check(`zoom ${zoom * 100}%: normal click after panning still selects the text run (Select tool still active)`, sel.join() === a.id && r.tool === "select", sel.join());
      const cb = r.client(b.x, b.y); r.down(cb, 0, true); await r.up(true);
      check(`zoom ${zoom * 100}%: shift-click still adds to the selection`, r.machine.getState().selectedObjectIds.length === 2);
    }

    // Hand tool: left drags pan, never select or move; switching back to Select restores selection
    for (const zoom of [0.5, 1, 2, 4]) {
      const r = new Router(s, 0, zoom);
      r.machine.reset();
      r.tool = "hand"; r.pan.hand = true;
      let problem = "";
      try { await probe.assertUnchanged(`hand ${zoom * 100}%`, async () => {
        const at = r.client(a.x, a.y), sy = r.scroll.y;
        if (r.down(at) !== "pan") throw new Error("hand press on a run not claimed");
        for (let i = 1; i <= 5; i++) r.move({ x: at.x, y: at.y - 20 * i });
        if (await r.up() !== null) throw new Error("hand release produced an intent");
        if (r.scroll.y !== sy + 100) throw new Error(`hand drag scrolled ${r.scroll.y - sy}, expected 100`);
        r.down({ x: 5, y: 5 }); r.move({ x: 400, y: 400 }); await r.up(); // would be a marquee in Select
        if (r.machine.getState().selectedObjectIds.length || r.machine.getState().phase !== "idle") throw new Error("hand drag selected something");
      }); } catch (e) { problem = (e as Error).message; }
      check(`zoom ${zoom * 100}%: Hand drags pan with no selection, mutation or history change`, !problem, problem);
      r.tool = "select"; r.pan.hand = false;
      const c = r.client(a.x, a.y); r.down(c); await r.up();
      check(`zoom ${zoom * 100}%: after switching back to Select a click selects the run`, r.machine.getState().selectedObjectIds.join() === a.id);
    }

    // positive control: a normal drag is still an object move, exactly one transaction
    const r = new Router(s, 0, 1.5);
    const before = probe.snapshot();
    const c = r.client(a.x, a.y);
    r.down(c); r.move({ x: c.x + 30, y: c.y + 15 }); r.move({ x: c.x + 60, y: c.y + 30 });
    const intent = await r.up();
    const after = probe.snapshot();
    const delta = (k: string) => (after.counters[k] ?? 0) - (before.counters[k] ?? 0);
    check("normal drag (no Space) still moves the object", intent?.type === "move");
    check("...as exactly one edit: 1 export, 1 reload, generation +1, history +1", delta("engine.export") === 1 && delta("engine.load") === 1 && after.generation === before.generation + 1 && after.past === before.past + 1);
    await s.undo();
    await s.dispose();
  }
}

(async () => {
  zoomMath();
  anchoring();
  panning();
  zoomBackdrop();
  await editorIntegration();
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
