/**
 * B-1.1: non-editing interactions must never mutate the PDF.
 *
 * Drives the REAL production gesture seam (src/lib/document/gestures.ts, the same functions EditorController's page
 * overlay calls) with a real InteractionStateMachine and a real EditorSession on real PDFs. The only test-side logic is a
 * thin "overlay driver" that does what the overlay does: convert client pixels to PDF points and, like
 * EditorController's onMove -> run(), apply any returned move intent with session.move. Because every returned
 * intent is applied, a leaked intent shows up as a counter change.
 *
 * Not covered here (no DOM harness): React event wiring itself, PdfViewer zoom/page-navigation state.
 */
import * as fs from "fs";
import * as path from "path";
import { EditorSession } from "../src/lib/pdf/editor/session";
import { InteractionStateMachine } from "../src/lib/document/interaction";
import { hitTestPoint } from "../src/lib/document/hittest";
import { pdfToViewportPoint, viewportToPdfPoint, PageCoordinateContext } from "../src/lib/document/coordinates";
import {
  gestureDown, gestureMove, gestureUp, gestureCancel, selectAllOnPage, hitCandidates,
  DRAG_THRESHOLD_PX, NOOP_MOVE_TOLERANCE_PX,
} from "../src/lib/document/gestures";
import { instrumentSession, Probe } from "./lib/mutation-probe";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
  if (!ok) failed++;
};
const wasm = () => new Uint8Array(fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm")).buffer as ArrayBuffer;
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;
const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join("tests", "fixtures", "pdfs", n)));

const ORIGIN = { left: 40, top: 60 }; // where the overlay sits in the viewport; proves client->page conversion is used

/** Mirrors EditorPageOverlay: client px -> PDF pt via the seam, apply returned move intents like EditorController.onMove. */
class Driver {
  machine = new InteractionStateMachine();
  constructor(public session: EditorSession, public pageIndex: number, public zoom: number) {}
  get page() { return this.session.getPage(this.pageIndex); }
  get ctx(): PageCoordinateContext { return { width: this.page.width, height: this.page.height, zoom: this.zoom, rotation: 0 }; }
  pt(cx: number, cy: number) { return viewportToPdfPoint({ x: cx - ORIGIN.left, y: cy - ORIGIN.top }, this.ctx); }
  client(x: number, y: number) { const v = pdfToViewportPoint({ x, y }, this.ctx); return { x: v.x + ORIGIN.left, y: v.y + ORIGIN.top }; }
  down(cx: number, cy: number, shift = false) { gestureDown(this.machine, this.page, this.pt(cx, cy), shift); }
  move(cx: number, cy: number) { return gestureMove(this.machine, this.pageIndex, this.pt(cx, cy), this.zoom); }
  /** release without applying: returns the intent */
  release(shift = false) { return gestureUp(this.machine, this.page, shift, this.zoom); }
  /** release and apply like the controller */
  async up(shift = false) {
    const intent = this.release(shift);
    if (intent?.type === "move") await this.session.move(this.pageIndex, intent.objectIds, intent.deltaX, intent.deltaY);
    return intent;
  }
  cancel() { gestureCancel(this.machine, this.pageIndex); }
  get state() { return this.machine.getState(); }
}

/** A run whose centre actually hits itself (not shadowed by a smaller overlapping object). */
function pickRuns(session: EditorSession, pageIndex: number, n: number) {
  const page = session.getPage(pageIndex);
  const out: { id: string; cx: number; cy: number }[] = [];
  for (const r of Object.values(page.layout.runs)) {
    const cx = (r.bounds.left + r.bounds.right) / 2, cy = (r.bounds.bottom + r.bounds.top) / 2;
    if (hitTestPoint({ x: cx, y: cy }, hitCandidates(page)) === r.id) out.push({ id: r.id, cx, cy });
    if (out.length === n) break;
  }
  return out;
}
/** A point on the page that hits nothing. */
function emptyPoint(session: EditorSession, pageIndex: number) {
  const page = session.getPage(pageIndex);
  for (let y = page.height - 12; y > 12; y -= 9) for (let x = 12; x < page.width - 12; x += 9) {
    if (hitTestPoint({ x, y }, hitCandidates(page)) === null) return { x, y };
  }
  throw new Error("no empty point on page");
}

async function main() {
  const probeFor = async (session: EditorSession) => instrumentSession(session);

  // ---------- fixture setup (before instrumentation): add an image so image selection can be tested ----------
  const s = new EditorSession();
  await s.open(fx("double coloumn sample.pdf"), wasm());
  {
    const page = s.getPage(0);
    let spot = { x: 0, y: 0 };
    outer: for (let y = 20; y < page.height - 100; y += 10) for (let x = 20; x < page.width - 130; x += 10) {
      const corners = [[x, y], [x + 60, y], [x, y + 40], [x + 60, y + 40], [x + 30, y + 20]];
      if (corners.every(([cx, cy]) => hitTestPoint({ x: cx, y: cy }, hitCandidates(page)) === null)) { spot = { x, y }; break outer; }
    }
    const px = new Uint8Array(4 * 4 * 4).fill(200);
    await s.addImage(0, { rgba: px, pixelWidth: 4, pixelHeight: 4, x: spot.x, y: spot.y, width: 60, height: 40 });
  }
  const probe: Probe = await probeFor(s);
  const noMutation = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try { await probe.assertUnchanged(name, fn); check(name, true); } catch (e: any) { check(name, false, e.message); }
  };

  const [runA, runB] = pickRuns(s, 0, 2);
  const emptyP = emptyPoint(s, 0);
  const imageObj = Object.values(s.getPage(0).objects).find(o => o.type === "image")!;
  console.log(`threshold=${DRAG_THRESHOLD_PX}px  no-op tolerance=${NOOP_MOVE_TOLERANCE_PX}px  runA=${runA.id} runB=${runB.id} image=${imageObj.id}`);

  // ---------- pointer down/up, empty space, shift, select-all, selection kinds ----------
  console.log("\n== selection and plain clicks (expect zero change)");
  {
    const d = new Driver(s, 0, 1);
    const c = d.client(runA.cx, runA.cy);
    await noMutation("down/up without movement on a run", async () => {
      d.down(c.x, c.y); await d.up();
    });
    check("  ...selects that run", d.state.selectedObjectIds.join() === runA.id && d.state.phase === "idle");

    const cb = d.client(runB.cx, runB.cy);
    await noMutation("shift-click adds, shift-click again removes", async () => {
      d.down(cb.x, cb.y, true); await d.up(true);
      if (d.state.selectedObjectIds.length !== 2) throw new Error("expected 2 selected");
      d.down(cb.x, cb.y, true); await d.up(true);
    });
    check("  ...shift toggle result", d.state.selectedObjectIds.join() === runA.id);

    const ce = d.client(emptyP.x, emptyP.y);
    await noMutation("empty-space click clears selection", async () => { d.down(ce.x, ce.y); await d.up(); });
    check("  ...selection cleared", d.state.selectedObjectIds.length === 0);

    await noMutation("hover / idle pointer moves are ignored", async () => {
      for (let i = 0; i < 20; i++) if (d.move(c.x + i, c.y + i)) throw new Error("move acted while idle");
    });

    const ci = d.client((imageObj.bounds.left + imageObj.bounds.right) / 2, (imageObj.bounds.bottom + imageObj.bounds.top) / 2);
    await noMutation("image selection", async () => { d.down(ci.x, ci.y); await d.up(); });
    check("  ...selected the image", d.state.selectedObjectIds.join() === imageObj.id);

    // paragraph/block: a point inside a block but outside every run
    const page = s.getPage(0);
    let blockHit: { x: number; y: number; id: string } | null = null;
    for (const b of Object.values(page.layout.textBlocks)) {
      for (let y = b.bounds.bottom + 1; y < b.bounds.top && !blockHit; y += 2) for (let x = b.bounds.left + 1; x < b.bounds.right && !blockHit; x += 3) {
        const id = hitTestPoint({ x, y }, hitCandidates(page));
        if (id && id.startsWith("block-")) blockHit = { x, y, id };
      }
      if (blockHit) break;
    }
    if (blockHit) {
      const cbk = d.client(blockHit.x, blockHit.y);
      await noMutation("paragraph (block) selection", async () => { d.down(cbk.x, cbk.y); await d.up(); });
      check("  ...selected the block", d.state.selectedObjectIds.join() === blockHit.id);
    } else check("paragraph (block) selection", false, "no point found that hits a block rather than a run");

    await noMutation("select all on page", async () => { selectAllOnPage(d.machine, d.page); });
    const pg = d.page;
    const nImages = Object.values(pg.objects).filter(o => o.type === "image").length;
    check("  ...selects every run and image", d.state.selectedObjectIds.length === Object.keys(pg.layout.runs).length + nImages, `${d.state.selectedObjectIds.length} of ${Object.keys(pg.layout.runs).length} runs + ${nImages} images`);
    await noMutation("clear selection (Escape reset)", async () => { d.machine.reset(); });
    check("  ...cleared", d.state.selectedObjectIds.length === 0 && d.state.activePage === null);
  }

  // ---------- marquee ----------
  console.log("\n== marquee");
  {
    const d = new Driver(s, 0, 1);
    const page = d.page;
    const r = page.layout.runs[runA.id];
    const a = d.client(emptyP.x, emptyP.y);
    const to = d.client(r.bounds.right + 2, r.bounds.top + 2);
    // start the rubber band on empty space just below-left of the run, so the box must enclose it
    let startPt: { x: number; y: number } | null = null;
    for (let k = 3; k <= 60 && !startPt; k += 3) {
      const p = { x: r.bounds.left - k, y: r.bounds.bottom - k };
      if (hitTestPoint(p, hitCandidates(page)) === null) startPt = p;
    }
    const startOk = !!startPt;
    const sx = startPt ? d.client(startPt.x, startPt.y) : a;
    await noMutation("marquee drag over a run", async () => {
      d.down(sx.x, sx.y);
      d.move((sx.x + to.x) / 2, (sx.y + to.y) / 2);
      d.move(to.x, to.y);
      await d.up();
    });
    check("  ...marquee selected something and left no gesture", d.state.selectedObjectIds.length >= 1 && d.state.phase === "idle", `selected=${d.state.selectedObjectIds.length} startOk=${startOk} run=${JSON.stringify(r.bounds)}`);
    await noMutation("tiny marquee (below 4pt) selects nothing and changes nothing", async () => {
      d.machine.reset();
      d.down(a.x, a.y); d.move(a.x + 1, a.y + 1); await d.up();
    });
    check("  ...nothing selected", d.state.selectedObjectIds.length === 0);
  }

  // ---------- threshold at all zooms ----------
  console.log("\n== 6px threshold at 50/100/150/200% (below and above; exactly 6.00 deliberately not asserted)");
  for (const zoom of [0.5, 1, 1.5, 2]) {
    const d = new Driver(s, 0, zoom);
    const offsets = [0, 0.13, 0.37, 0.5, 0.81];
    let below = 0, belowN = 0, aboveOk = 0, aboveN = 0, sizeOk = 0;
    const belowMoves: [number, number][] = [[5.99, 0], [-5.99, 0], [0, 5.99], [0, -5.99], [4.2, 4.2], [-4.2, 4.2]]; // 4.2,4.2 = 5.94px
    const aboveMoves: [number, number][] = [[6.01, 0], [-6.01, 0], [0, 6.01], [0, -6.01], [4.26, 4.26], [-4.26, -4.26]]; // 6.02px
    const c0 = d.client(runA.cx, runA.cy);
    for (const off of offsets) {
      const cx = c0.x + off, cy = c0.y + off;
      for (const [dx, dy] of belowMoves) {
        belowN++;
        d.machine.reset();
        d.down(cx, cy); d.move(cx + dx, cy + dy);
        const ph = d.state.phase;
        const intent = d.release();
        if (ph === "pointer_down" && intent === null && d.state.phase === "idle") below++;
      }
      for (const [dx, dy] of aboveMoves) {
        aboveN++;
        d.machine.reset();
        d.down(cx, cy); d.move(cx + dx, cy + dy);
        const ph = d.state.phase;
        const intent = d.release(); // NOT applied here
        if (ph === "dragging" && intent?.type === "move") {
          aboveOk++;
          const px = Math.hypot(intent.deltaX, intent.deltaY) * zoom;
          if (Math.abs(px - Math.hypot(dx, dy)) < 1e-6) sizeOk++;
        }
      }
    }
    check(`zoom ${zoom * 100}%: below threshold stays a click`, below === belowN, `${below}/${belowN}`);
    check(`zoom ${zoom * 100}%: above threshold becomes a drag with a move intent`, aboveOk === aboveN, `${aboveOk}/${aboveN}`);
    check(`zoom ${zoom * 100}%: intent displacement equals pointer travel in px`, sizeOk === aboveN, `${sizeOk}/${aboveN}`);
    // and the below-threshold clicks, if (wrongly) applied, would have been detectable: prove none touched the document
    await noMutation(`zoom ${zoom * 100}%: 36 sub-threshold jitter clicks, each applied if it returned an intent`, async () => {
      for (const [dx, dy] of belowMoves) { d.machine.reset(); d.down(c0.x, c0.y); d.move(c0.x + dx, c0.y + dy); await d.up(); }
    });
  }

  // ---------- cancel / lost capture / escape / no-op ----------
  console.log("\n== cancel, lost capture, escape, no-op drags (expect zero change)");
  {
    const d = new Driver(s, 0, 1);
    const c = d.client(runA.cx, runA.cy);
    await noMutation("pointercancel mid-drag", async () => {
      d.down(c.x, c.y); d.move(c.x + 60, c.y + 30);
      if (d.state.phase !== "dragging") throw new Error("setup: expected dragging");
      d.cancel(); // EditorController: onPointerCancel -> gestureCancel
      const stray = await d.up(); // a stray pointerup afterwards must be inert
      if (stray) throw new Error("stray pointerup produced an intent");
    });
    check("  ...state machine idle, not stuck", d.state.phase === "idle" && d.state.dragStartPoint === null);
    await noMutation("lostpointercapture mid-drag (same handler)", async () => {
      d.down(c.x, c.y); d.move(c.x + 80, c.y); d.cancel(); await d.up();
    });
    await noMutation("lostpointercapture mid-marquee", async () => {
      const e = d.client(emptyP.x, emptyP.y); d.machine.reset(); d.down(e.x, e.y); d.move(e.x + 50, e.y + 50); d.cancel(); await d.up();
    });
    check("  ...marquee cancel leaves nothing stuck", d.state.phase === "idle");
    await noMutation("lostpointercapture after a normal release is a no-op", async () => { d.machine.reset(); d.down(c.x, c.y); await d.up(); d.cancel(); });

    // subsequent interactions work normally after a cancel
    const cb = d.client(runB.cx, runB.cy);
    await noMutation("click after cancel works normally", async () => {
      d.down(c.x, c.y); d.move(c.x + 50, c.y); d.cancel();
      d.down(cb.x, cb.y); await d.up();
    });
    check("  ...next click selected the other run", d.state.selectedObjectIds.join() === runB.id && d.state.phase === "idle");

    await noMutation("Escape during drag (controller resets the machine), then release", async () => {
      d.down(c.x, c.y); d.move(c.x + 60, c.y + 20);
      d.machine.reset(); // EditorController Escape handler
      const intent = await d.up();
      if (intent) throw new Error("release after Escape produced an intent");
    });
    check("  ...selection cleared by Escape", d.state.selectedObjectIds.length === 0);

    await noMutation("drag out and return exactly to the start", async () => {
      d.machine.reset(); d.down(c.x, c.y); d.move(c.x + 90, c.y + 40); d.move(c.x, c.y);
      const intent = await d.up(); if (intent) throw new Error("no-op drag produced an intent");
    });
    await noMutation(`drag out and return within ${NOOP_MOVE_TOLERANCE_PX}px of the start`, async () => {
      d.machine.reset(); d.down(c.x, c.y); d.move(c.x + 90, c.y + 40); d.move(c.x + 0.2, c.y);
      const intent = await d.up(); if (intent) throw new Error("sub-tolerance drag produced an intent");
    });
    // a deliberate small move just beyond tolerance is NOT swallowed
    d.machine.reset(); d.down(c.x, c.y); d.move(c.x + 90, c.y); d.move(c.x + 1, c.y);
    const small = d.release();
    check("a 1px net move after crossing the threshold is still a legitimate move", small?.type === "move" && Math.abs(small.deltaX - 1) < 1e-6);
  }

  // ---------- zoom / page navigation ----------
  console.log("\n== zoom and page navigation");
  {
    await noMutation("same click at zoom 50/100/150/200% selects the same run", async () => {
      for (const z of [0.5, 1, 1.5, 2]) {
        const d = new Driver(s, 0, z); const c = d.client(runA.cx, runA.cy);
        d.down(c.x, c.y); await d.up();
        if (d.state.selectedObjectIds.join() !== runA.id) throw new Error(`zoom ${z}: selected ${d.state.selectedObjectIds}`);
      }
    });
    const [p1run] = pickRuns(s, 1, 1);
    await noMutation("select on page 0, then on page 1 (selection never spans pages)", async () => {
      const d0 = new Driver(s, 0, 1); const m = d0.machine;
      const c0 = d0.client(runA.cx, runA.cy); d0.down(c0.x, c0.y); await d0.up();
      const d1 = new Driver(s, 1, 1); (d1 as any).machine = m; // same machine, as in the controller
      const c1 = d1.client(p1run.cx, p1run.cy); d1.down(c1.x, c1.y); await d1.up();
      if (m.getState().activePage !== 1 || m.getState().selectedObjectIds.join() !== p1run.id) throw new Error("selection did not move to page 1");
    });
    const viewer = fs.readFileSync("src/components/pdf/viewer/PdfViewer.tsx", "utf8");
    check("PdfViewer (zoom, page nav, scroll) has no reference to the editor session or engine",
      !/EditorSession|editor\/session|editor\/engine|PdfEditorEngine|\.move\(|\.remove\(/.test(viewer));
  }

  // ---------- positive controls ----------
  console.log("\n== positive controls: instrumentation must detect real mutations");
  {
    const d = new Driver(s, 0, 1);
    // ids carry the generation: after each committed edit/undo re-stamp the same objects (undo restores the same layout)
    const cur = (id: string) => id.replace(/@\d+$/, "@" + s.generation);
    const srcIds = s.resolveSourceIds(0, [runA.id]);
    const k = srcIds.length;

    // controlled violation 1: the OLD behaviour (cancel wired to pointer-up) must be caught by the probe
    let caught = false;
    try {
      await probe.assertUnchanged("legacy cancel wiring", async () => {
        const c = d.client(runA.cx, runA.cy);
        d.machine.reset(); d.down(c.x, c.y); d.move(c.x + 60, c.y);
        await d.up(); // legacy: onPointerCancel={onPointerUp}
      });
    } catch { caught = true; }
    check("controlled violation: legacy 'cancel commits the drag' IS detected by the probe", caught);
    await s.undo();

    // controlled violation 2: a selection-time mutation (what a regression would look like) is detected
    let caught2 = false;
    try { await probe.assertUnchanged("selection that mutates", async () => { await s.move(0, [cur(runA.id)], 0.5, 0); }); } catch { caught2 = true; }
    check("controlled violation: a mutation hidden inside a 'selection' IS detected", caught2);
    await s.undo();

    // drag via the seam, applied
    let before = probe.snapshot();
    const c = d.client(runA.cx, runA.cy);
    d.machine.reset(); d.down(c.x, c.y); d.move(c.x + 40, c.y + 20); d.move(c.x + 80, c.y + 40);
    const intent = await d.up();
    let after = probe.snapshot();
    const cnt = (sn: any, key: string) => sn.counters[key] ?? 0;
    const delta = (key: string) => cnt(after, key) - cnt(before, key);
    check("drag-move intent produced", intent?.type === "move");
    check(`drag-move: engine.moveObject +${k}, transformObject +${k}`, delta("engine.moveObject") === k && delta("engine.transformObject") === k, `+${delta("engine.moveObject")}/+${delta("engine.transformObject")}`);
    check("drag-move: exactly 1 export and 1 reload", delta("engine.export") === 1 && delta("engine.load") === 1 && delta("pdfium.FPDF_SaveAsCopy") === 1 && delta("pdfium.FPDF_LoadMemDocument") === 1);
    check("drag-move: generation +1, history +1, bytes replaced", after.generation === before.generation + 1 && after.past === before.past + 1 && !same(after.bytes, before.bytes));
    check("drag-move: raw PDFium Transform +" + k, delta("pdfium.FPDFPageObj_Transform") === k);

    // nudge (arrow key = session.move by 1pt)
    before = probe.snapshot();
    await s.move(0, s.layoutIdsFor(0, srcIds.map(cur)), 1, 0); // ids are re-derived after the drag's reload; follow the source objects
    after = probe.snapshot();
    check("nudge (1pt move): same counters as a move", delta("engine.moveObject") === k && delta("engine.export") === 1 && delta("engine.load") === 1 && after.past === before.past + 1 && after.generation === before.generation + 1);

    // delete
    before = probe.snapshot();
    await s.remove(0, [Object.values(s.getPage(0).layout.runs)[0].id]);
    after = probe.snapshot();
    check("delete: deleteObject >= 1, 1 export, 1 reload, history +1, bytes replaced",
      delta("engine.deleteObject") >= 1 && delta("pdfium.FPDFPage_RemoveObject") === delta("engine.deleteObject") && delta("engine.export") === 1 && delta("engine.load") === 1 && after.past === before.past + 1 && !same(after.bytes, before.bytes),
      `deleteObject +${delta("engine.deleteObject")}`);

    // undo
    before = probe.snapshot();
    await s.undo();
    after = probe.snapshot();
    check("undo: 1 reload, 0 exports, history -1 / redo +1, bytes replaced",
      delta("engine.load") === 1 && delta("engine.export") === 0 && after.past === before.past - 1 && after.future === before.future + 1 && !same(after.bytes, before.bytes));
  }

  // ---------- state machine usable after everything ----------
  {
    const d = new Driver(s, 0, 1);
    d.machine.reset();
    const [fresh] = pickRuns(s, 0, 1); // run ids/geometry changed with the edits above
    const c = d.client(fresh.cx, fresh.cy);
    d.down(c.x, c.y); await d.up();
    check("machine still works after the whole run", d.state.phase === "idle" && d.state.selectedObjectIds.join() === fresh.id);
  }

  await s.dispose();
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
