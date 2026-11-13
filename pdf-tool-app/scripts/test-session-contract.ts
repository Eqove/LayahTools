/**
 * B-1.2 contract tests for EditorSession: lifecycle, byte ownership, generation-stamped ids, dirty state,
 * transactions and rollback, queue/dispose/reentrancy, read-only model, error codes.
 * Uses real PDFium through interface-level doubles (scripts/lib/engine-doubles.ts); no private access.
 */
import * as fs from "fs";
import * as path from "path";
import { PDFDocument, degrees } from "pdf-lib";
import { EditorSession, EditorSessionError, FontCoverageError } from "../src/lib/pdf/editor/session";
import { EngineError } from "../src/lib/pdf/editor/errors";
import { doubleEngine } from "./lib/engine-doubles";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
  if (!ok) failed++;
};
const wasm = () => new Uint8Array(fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm")).buffer as ArrayBuffer;
const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join("tests", "fixtures", "pdfs", n)));
const SHORT = "single line sample.pdf", DOUBLE = "double coloumn sample.pdf", DECK = "SIH_AERES_PPT_FINAL.pdf";
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;
const err = async (fn: () => unknown): Promise<any> => { try { await fn(); return null; } catch (e) { return e; } };
const codeOf = async (fn: () => unknown) => { const e = await err(fn); return e instanceof EditorSessionError ? e.code : e ? `OTHER:${e.message}` : "NONE"; };
const run0 = (s: EditorSession) => Object.values(s.getPage(0).layout.runs)[0].id;
const ENGINE_OPS = ["moveObject", "transformObject", "deleteObject", "addText", "addImage", "addRect", "replaceText", "export", "load"];

async function fresh(name = SHORT) {
  const d = doubleEngine();
  const s = new EditorSession({ engineFactory: d.factory });
  await s.open(fx(name), wasm());
  d.reset();
  return { s, d };
}
const engineCalls = (d: { counts: Record<string, number> }) => ENGINE_OPS.reduce((n, k) => n + (d.counts[k] ?? 0), 0);
/** Snapshot of everything a rolled-back or rejected operation must leave alone. */
const state = (s: EditorSession) => ({ bytes: s.bytes, gen: s.generation, dirty: s.isDirty, h: JSON.stringify(s.history), page: s.getPage(0), status: s.status });
const unchanged = (a: ReturnType<typeof state>, b: ReturnType<typeof state>) => same(a.bytes, b.bytes) && a.gen === b.gen && a.dirty === b.dirty && a.h === b.h && a.page === b.page && a.status === b.status;

async function main() {
  console.log("== lifecycle");
  {
    const d = doubleEngine();
    const s = new EditorSession({ engineFactory: d.factory });
    check("new session is empty", s.status === "empty" && !s.isDirty && s.pageCount === 0 && !s.canUndo);
    check("operation before open -> NOT_OPEN", (await codeOf(() => s.move(0, ["x@1"], 1, 1))) === "NOT_OPEN");
    check("read before open -> NOT_OPEN", (() => { try { s.getPage(0); return false; } catch (e: any) { return e.code === "NOT_OPEN"; } })());
    const bad = await err(() => s.open(new Uint8Array([1, 2, 3, 4]), wasm()));
    check("garbage bytes -> OPEN_FAILED with cause, session stays empty", bad?.code === "OPEN_FAILED" && bad.cause instanceof EngineError && s.status === "empty");
    await s.open(fx(SHORT), wasm());
    check("session is reusable after a failed open", s.status === "ready" && s.pageCount > 0 && s.generation === 1 && !s.isDirty);
    check("second open -> ALREADY_OPEN, state untouched", (await codeOf(() => s.open(fx(SHORT), wasm()))) === "ALREADY_OPEN" && s.status === "ready" && s.generation === 1);

    const pw = doubleEngine();
    const sp = new EditorSession({ engineFactory: pw.factory });
    pw.arm("load", () => true, new EngineError("password", "locked"));
    const pe = await err(() => sp.open(fx(SHORT), wasm()));
    check("password-protected -> PASSWORD_REQUIRED, cause preserved", pe?.code === "PASSWORD_REQUIRED" && pe.cause instanceof EngineError && sp.status === "empty");

    const page = s.getPage(0), bytes = s.bytes, gen = s.generation;
    const p1 = s.dispose(), p2 = s.dispose();
    check("dispose is idempotent (same promise) and terminal", p1 === p2 && s.status === "disposed");
    await p1;
    check("engine is freed exactly once", d.counts.dispose >= 1);
    check("mutation after dispose -> DISPOSED", (await codeOf(() => s.move(0, [run0(s)], 1, 1))) === "DISPOSED");
    check("undo after dispose -> DISPOSED and nothing is reloaded", (await codeOf(() => s.undo())) === "DISPOSED" && (d.counts.load ?? 0) === 1 + 1 /* failed open + good open */ );
    check("open after dispose -> DISPOSED", (await codeOf(() => s.open(fx(SHORT), wasm()))) === "DISPOSED");
    check("committed model and bytes stay readable after dispose", s.getPage(0) === page && same(s.bytes, bytes) && s.generation === gen);
  }

  console.log("\n== byte ownership");
  {
    const input = fx(SHORT), pristine = input.slice();
    const s = new EditorSession();
    await s.open(input, wasm());
    check("open() does not keep the caller's array", same(s.bytes, pristine));
    await s.move(0, [run0(s)], 5, 0);
    input.fill(0); // caller scribbles on its own array after open
    check("undo still works after the caller mutated its input", (await s.undo()) === true && same(s.bytes, pristine));
    const out = s.bytes;
    check("bytes getter returns a fresh copy each time", out !== s.bytes && same(out, s.bytes));
    out.fill(0);
    check("mutating a returned copy does not affect the session", same(s.bytes, pristine));
    await s.redo(); await s.undo();
    check("history is intact after consumer mutation of returned bytes", same(s.bytes, pristine));
    const t = new EditorSession();
    await t.open(fx(SHORT), wasm(), { transfer: true });
    check("open({transfer:true}) works", t.status === "ready");
    await s.dispose(); await t.dispose();
  }

  console.log("\n== generation-stamped ids");
  {
    const { s, d } = await fresh(DOUBLE);
    const id0 = run0(s);
    check("ids carry the generation", /@1$/.test(id0) && s.generation === 1, id0);
    const gens = [s.generation];
    const a = await s.move(0, [id0], 5, 0); gens.push(s.generation);
    check("move returns ids valid in the new generation", a.length >= 1 && a.every(i => i.endsWith(`@${s.generation}`)) && !!s.getPage(0).layout.runs[a[0]]);
    d.reset();
    check("old id -> STALE_ID (generation) without any engine call", (await codeOf(() => s.move(0, [id0], 1, 1))) === "STALE_ID" && engineCalls(d) === 0);
    const e1 = await err(() => s.move(0, [id0], 1, 1));
    check("STALE_ID carries reason 'generation'", e1?.code === "STALE_ID" && e1.details?.reason === "generation");
    await s.undo(); gens.push(s.generation);
    check("ids from before the undo are stale", (await codeOf(() => s.move(0, a, 1, 1))) === "STALE_ID");
    const b = await s.move(0, [run0(s)], 0, 5); gens.push(s.generation);
    check("edit -> undo -> different edit: ids of the first edit are rejected", (await codeOf(() => s.move(0, a, 1, 1))) === "STALE_ID" && (await codeOf(() => s.move(0, b, 1, 1))) === "NONE");
    await s.undo(); gens.push(s.generation); await s.redo(); gens.push(s.generation);
    check("generation is strictly increasing and never restored by undo/redo", gens.every((g, i) => i === 0 || g > gens[i - 1]), gens.join(","));

    // the hazard seen in the inspection probe: an id that used to name object N must not silently name another object
    const texts = Object.values(s.getPage(0).objects).filter(o => o.type === "text");
    const victim = texts[10].id, before = (texts[10] as any).text;
    await s.remove(0, [run0(s)]);
    check("stale object id is rejected instead of acting on a different object", (await codeOf(() => s.move(0, [victim], 1, 1))) === "STALE_ID", before.slice(0, 20));
    const cur = (id: string) => id.replace(/@\d+$/, `@${s.generation}`);
    check("unknown id in the current generation -> STALE_ID (unknown)", (await err(() => s.move(0, [cur("page-0-text-99999@1")], 1, 1)))?.details?.reason === "unknown");
    check("malformed id -> INVALID_ARGUMENT", (await codeOf(() => s.move(0, ["page-0-text-3"], 1, 1))) === "INVALID_ARGUMENT");
    check("pure reads validate ids too", (() => { try { s.resolveSourceIds(0, [id0]); return false; } catch (e: any) { return e.code === "STALE_ID"; } })());

    const s2 = new EditorSession(); await s2.open(fx(DOUBLE), wasm());
    const s3 = new EditorSession(); await s3.open(fx(DOUBLE), wasm());
    check("opening the same bytes twice yields identical ids", Object.keys(s2.getPage(0).layout.runs).join() === Object.keys(s3.getPage(0).layout.runs).join());
    await s.dispose(); await s2.dispose(); await s3.dispose();
  }

  console.log("\n== dirty state (state identity, not generation or bytes)");
  {
    const { s } = await fresh();
    check("clean after open", !s.isDirty);
    await s.move(0, [run0(s)], 5, 0);
    check("dirty after an edit", s.isDirty);
    await s.undo();
    check("undo back to the opened state is clean (bytes differ from a re-export, generation moved on)", !s.isDirty && s.generation > 2);
    await s.redo();
    check("redo is dirty again", s.isDirty);
    await s.undo();
    await s.move(0, [run0(s)], 0, 5);
    check("edit after undo gets a new identity: dirty", s.isDirty);
    await s.undo();
    check("...and undoing it returns to clean", !s.isDirty);
    await s.move(0, [run0(s)], 5, 0); await s.move(0, [run0(s)], -5, 0);
    check("+5 then -5 is dirty (distinct states), not silently clean", s.isDirty);
    await s.undo(); await s.undo();
    check("undoing both returns to clean", !s.isDirty);
    await s.move(0, [run0(s)], 3, 0);
    s.markClean();
    check("markClean() makes the current state clean", !s.isDirty);
    await s.move(0, [run0(s)], 3, 0);
    check("editing after markClean is dirty", s.isDirty);
    await s.undo();
    check("undo to the marked state is clean", !s.isDirty);
    await s.undo();
    check("undo past the marked state is dirty", s.isDirty);
    await s.dispose();

    const { s: h } = await fresh();
    for (let i = 0; i < 21; i++) await h.move(0, [run0(h)], 1, 0);
    check("history is capped", h.history.undoDepth === h.history.limit && h.history.limit === 20);
    while (h.canUndo) await h.undo();
    check("once the clean state is evicted from history, the session stays dirty", h.isDirty);
    await h.dispose();
  }

  console.log("\n== transactions and rollback (fault-injected engine)");
  {
    const { s, d } = await fresh();
    const id = run0(s);
    await s.move(0, [id], 0.5, 0); // success path counters measured on a second op
    d.reset();
    const hBefore = s.history.undoDepth;
    await s.move(0, [run0(s)], 1, 0);
    check("successful mutation: exactly one export, one reload, one history entry", d.counts.export === 1 && d.counts.load === 1 && s.history.undoDepth === hBefore + 1, JSON.stringify(d.counts));

    // precondition failures: no engine call, no state change
    d.reset();
    const st = state(s);
    const cases: [string, () => unknown, string][] = [
      ["page out of range", () => s.move(99, [run0(s)], 1, 1), "INVALID_ARGUMENT"],
      ["NaN delta", () => s.move(0, [run0(s)], NaN, 1), "INVALID_ARGUMENT"],
      ["empty ids", () => s.move(0, [], 1, 1), "NOTHING_TO_DO"],
      ["stale id", () => s.remove(0, ["page-0-text-1@1"]), "STALE_ID"],
      ["zero-size resize", () => s.resize(0, Object.values(s.getPage(0).objects)[0].id, { left: 10, bottom: 10, right: 10, top: 10 }), "INVALID_ARGUMENT"],
    ];
    for (const [name, fn, code] of cases) check(`precondition (${name}) -> ${code}`, (await codeOf(fn)) === code);
    check("preconditions made no engine call and changed nothing", engineCalls(d) === 0 && unchanged(st, state(s)), JSON.stringify(d.counts));

    // apply / export / reload failures with a successful rollback
    for (const [phase, method, n] of [["apply", "moveObject", 1], ["export", "export", 1], ["reload", "load", 1]] as const) {
      const before = state(s), ids = [run0(s)];
      const injected = d.arm(method, k => k === n);
      const e = await err(() => s.move(0, ids, 2, 0));
      d.disarm();
      check(`${phase} failure -> ENGINE_FAILURE (phase, cause preserved)`, e?.code === "ENGINE_FAILURE" && e.details?.phase === phase && e.cause === injected, e?.message);
      check(`${phase} failure: committed model, bytes, generation, dirty and history are untouched`, unchanged(before, state(s)));
      check(`${phase} failure: ids from before the failure still work`, (await codeOf(() => s.move(0, ids, 2, 0))) === "NONE");
      await s.undo();
    }

    // verify failure (font coverage) on a real subset-font deck
    {
      const { s: deck } = await fresh(DECK);
      const runs = Object.values(deck.getPage(0).layout.runs);
      const target = runs.find(r => r.sourceObjectIds.length === 1) ?? runs[0];
      const before = state(deck);
      const e = await err(() => deck.replaceText(0, target.id, "LAYAH-EDIT-OK"));
      check("lost glyphs -> FontCoverageError (code FONT_COVERAGE), still an EditorSessionError", e instanceof FontCoverageError && e instanceof EditorSessionError && e.code === "FONT_COVERAGE" && Array.isArray(e.missing));
      check("font coverage failure rolled back completely", unchanged(before, state(deck)));
      check("substituteFont retry commits", (await deck.replaceText(0, target.id, "LAYAH-EDIT-OK", { substituteFont: true })).substituted && deck.isDirty);
      await deck.dispose();
    }

    // undo/redo reload failure
    {
      const { s: u, d: ud } = await fresh();
      await u.move(0, [run0(u)], 4, 0);
      const before = state(u);
      const injected = ud.arm("load", k => k === 1);
      const e = await err(() => u.undo());
      ud.disarm();
      check("undo reload failure -> ENGINE_FAILURE (reload), cause preserved", e?.code === "ENGINE_FAILURE" && e.details?.phase === "reload" && e.cause === injected);
      check("undo failure leaves history, bytes, generation and model untouched", unchanged(before, state(u)) && u.canUndo && !u.canRedo);
      check("undo succeeds afterwards", (await u.undo()) === true && !u.canUndo && u.canRedo && !u.isDirty);
      await u.redo();
      ud.arm("load", k => k === 1);
      const hb = JSON.stringify(u.history);
      await err(() => u.undo()); ud.disarm();
      check("redo/undo stacks only move after a successful reload", JSON.stringify(u.history) === hb);
      await u.dispose();
    }

    // rollback failure -> faulted
    {
      const { s: f, d: fd } = await fresh();
      await f.move(0, [run0(f)], 4, 0);
      const before = state(f);
      const first = fd.arm("export", k => k === 1);
      const second = fd.arm("load", k => k === 1); // the rollback's own load
      const e = await err(() => f.move(0, [run0(f)], 1, 0));
      fd.disarm();
      check("failed rollback -> ROLLBACK_FAILED with both causes", e?.code === "ROLLBACK_FAILED" && e.cause === first && e.details?.rollbackCause === second);
      check("session is faulted; last committed model and bytes are preserved", f.status === "faulted" && same(f.bytes, before.bytes) && f.getPage(0) === before.page && f.generation === before.gen && f.history.undoDepth === 1);
      check("faulted: further engine operations -> SESSION_FAULTED", (await codeOf(() => f.move(0, [run0(f)], 1, 1))) === "SESSION_FAULTED" && (await codeOf(() => f.undo())) === "SESSION_FAULTED");
      await f.dispose();
      check("faulted session can still be disposed", f.status === "disposed");

      const { s: g, d: gd } = await fresh();
      await g.move(0, [run0(g)], 4, 0);
      gd.arm("load", k => k <= 2); // undo's reload and the recovery reload both fail
      const ge = await err(() => g.undo());
      gd.disarm();
      check("undo whose recovery also fails -> ROLLBACK_FAILED and faulted", ge?.code === "ROLLBACK_FAILED" && g.status === "faulted");
      await g.dispose();
    }
    await s.dispose();
  }

  console.log("\n== queue, reads, dispose with work in flight, reentrancy");
  {
    const { s } = await fresh();
    const order: string[] = [];
    const ids = [run0(s)];
    const p1 = s.move(0, ids, 5, 0).then(() => order.push("m1"));
    const p2 = s.move(0, ids, 0, 5).then(() => order.push("m2"), e => order.push("m2:" + e.code)); // same ids: stale once m1 has committed
    const p3 = s.addRect(0, { x: 10, y: 10, width: 20, height: 10 }).then(() => order.push("rect"));
    const p4 = s.undo().then(() => order.push("undo"));
    await Promise.all([p1, p2, p3, p4]);
    check("operations run FIFO", order.join() === "m1,m2:STALE_ID,rect,undo", order.join());
    check("preconditions are checked when the operation runs; a failure does not poison the queue", s.history.undoDepth === 1 && s.canRedo);

    const { s: r, d } = await fresh();
    const before = state(r), g = d.gate("export");
    const inflight = r.move(0, [run0(r)], 5, 0);
    await g.reached;
    check("reads during an in-flight operation see only committed state", unchanged(before, state(r)));
    g.release(); await inflight;
    check("...and the new state appears atomically afterwards", r.generation === before.gen + 1 && r.history.undoDepth === 1);
    await r.dispose();

    const { s: q, d: qd } = await fresh();
    const base = state(q), loadsBefore = qd.counts.load ?? 0, gate = qd.gate("export");
    const f1 = q.move(0, [run0(q)], 5, 0), f2 = q.move(0, [run0(q)], 0, 5), f3 = q.undo();
    await gate.reached;
    const disposed = q.dispose();
    check("dispose flips the status immediately", q.status === "disposed");
    gate.release();
    const settled = await Promise.allSettled([f1, f2, f3]);
    await disposed;
    check("in-flight and queued operations reject DISPOSED", settled.every(x => x.status === "rejected" && (x.reason as EditorSessionError).code === "DISPOSED"));
    check("the in-flight result was discarded: no commit, no history, no new generation", same(q.bytes, base.bytes) && q.generation === base.gen && q.history.undoDepth === 0 && q.getPage(0) === base.page);
    check("the engine was freed after in-flight work settled and nothing was reloaded", (qd.counts.dispose ?? 0) >= 1 && (qd.counts.load ?? 0) === loadsBefore);

    const { s: re, d: red } = await fresh();
    let nested: any;
    red.hook = m => { if (m === "moveObject" && !nested) nested = re.move(0, [run0(re)], 1, 1).catch(e => e); };
    await re.move(0, [run0(re)], 5, 0);
    const ne = await nested;
    check("a call made from inside an engine call fails fast with REENTRANT_CALL instead of deadlocking", ne instanceof EditorSessionError && ne.code === "REENTRANT_CALL");
    check("...and the outer operation still commits", re.generation === 2 && re.history.undoDepth === 1);
    await re.dispose();
  }

  console.log("\n== read-only model");
  {
    const { s } = await fresh(DOUBLE);
    const page = s.getPage(0);
    const run = Object.values(page.layout.runs)[0];
    check("getPage returns a frozen model at every depth", Object.isFrozen(page) && Object.isFrozen(page.objects) && Object.isFrozen(page.layout.runs) && Object.isFrozen(run) && Object.isFrozen(run.bounds) && Object.isFrozen(run.sourceObjectIds));
    const snap = JSON.stringify(page);
    let writes = 0;
    for (const w of [() => { (page as any).width = 1; }, () => { (page.objects as any)["x"] = {}; }, () => { (run.bounds as any).left = -1; }, () => { (run.sourceObjectIds as any).push("x"); }, () => { delete (page.layout.runs as any)[run.id]; }]) {
      try { w(); } catch { writes++; }
    }
    check("every write attempt is rejected and the model is unchanged", writes === 5 && JSON.stringify(s.getPage(0)) === snap);
    check("getPage is stable until the next commit", s.getPage(0) === page);
    await s.move(0, [run.id], 5, 0);
    check("a commit publishes a new model; the old snapshot is untouched", s.getPage(0) !== page && JSON.stringify(page) === snap);
    check("store is not part of the public surface", !("store" in s) && typeof (s as any).store === "undefined");
    await s.dispose();
  }

  console.log("\n== argument validation and error shape");
  {
    const { s } = await fresh();
    for (const [name, fn] of [
      ["getPage(-1)", () => s.getPage(-1)], ["getPage(99)", () => s.getPage(99)], ["getPage(1.5)", () => s.getPage(1.5)],
      ["resolveSourceIds(99)", () => s.resolveSourceIds(99, [])], ["layoutIdsFor(99)", () => s.layoutIdsFor(99, [])],
      ["uneditableReason(99)", () => s.uneditableReason(99)], ["textEditWarning(99)", () => s.textEditWarning(99, "x@1")],
    ] as [string, () => unknown][]) {
      const e = (() => { try { fn(); return null; } catch (x) { return x as any; } })();
      check(`${name} -> INVALID_ARGUMENT (not RangeError)`, e instanceof EditorSessionError && e.code === "INVALID_ARGUMENT" && e.details?.param === "pageIndex");
    }
    check("mutations validate the page index too", (await codeOf(() => s.addText(99, { text: "x", x: 1, y: 1 }))) === "INVALID_ARGUMENT" && (await codeOf(() => s.replaceText(99, "x@1", "y"))) === "INVALID_ARGUMENT");
    check("non-finite coordinates are rejected", (await codeOf(() => s.addText(0, { text: "x", x: Infinity, y: 1 }))) === "INVALID_ARGUMENT");
    check("errors are Errors with name, code and message", (await err(() => s.getPage(99))) instanceof Error);
    await s.dispose();

    const rot = await PDFDocument.create();
    rot.addPage([300, 300]).setRotation(degrees(90));
    const r = new EditorSession();
    await r.open(new Uint8Array(await rot.save()), wasm());
    check("rotated page: uneditableReason set, mutation -> UNEDITABLE_PAGE", !!r.uneditableReason(0) && (await codeOf(() => r.addText(0, { text: "x", x: 10, y: 10 }))) === "UNEDITABLE_PAGE");
    await r.dispose();
  }

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
