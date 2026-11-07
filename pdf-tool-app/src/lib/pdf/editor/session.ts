import { PdfEditorEngine } from "./engine";
import type { EditorEngine } from "./engine-contract";
import { EditorSessionError, EngineError, FontCoverageError } from "./errors";
import type { PdfImageOptions, PdfRectOptions, PdfTextOptions } from "./types";
import { PdfToLayahMapper } from "../../document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../../document/geometry";
import { inferTextLines, LayahTextLine } from "../../document/lines";
import { inferTextRuns } from "../../document/runs";
import { inferTextBlocks } from "../../document/blocks";
import { LayahDocumentStore } from "../../document/store";
import type { DeepReadonly, LayahObjectBounds, LayahPage, LayahSourceObject, LayahTextObject } from "../../document/types";

export { EditorSessionError, FontCoverageError };
export type { EditorErrorCode } from "./errors";

const MAX_HISTORY = 20;

export type SessionStatus = "empty" | "ready" | "faulted" | "disposed";
type Phase = "apply" | "export" | "reload" | "verify";

/** One history entry: exported bytes plus the identity of the document state they represent. */
interface Snapshot { bytes: Uint8Array; stateId: number }

/** Everything that describes one committed document state. Reads only ever see the last committed one. */
interface Committed {
  bytes: Uint8Array;
  stateId: number;          // identity of this document state (restored by undo/redo); drives isDirty
  generation: number;       // id-stamp scope of this model build; session-monotonic, never restored
  store: LayahDocumentStore;
  ptrs: Map<string, string>;
  lines: Map<number, Map<string, LayahTextLine>>;
  uneditable: Map<number, string>;
  pageCount: number;
}

const emptyState = (): Committed => ({ bytes: new Uint8Array(), stateId: 0, generation: 0, store: new LayahDocumentStore(), ptrs: new Map(), lines: new Map(), uneditable: new Map(), pageCount: 0 });

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

const stampOf = (id: string, gen: number) => `${id}@${gen}`;
const restamp = (ids: string[], gen: number) => ids.map(i => i.replace(/@\d+$/, `@${gen}`));

/**
 * One open document being edited. Lifecycle: `empty -> ready -> disposed` (`faulted` if a rollback itself fails).
 *
 * - Every mutation is a transaction: validate -> apply -> export -> reload + stage -> verify -> atomic commit.
 *   Failure rolls the engine back to the last committed bytes; the committed model, bytes, ids, generation and
 *   history are never partially updated. If the rollback itself fails the session becomes `faulted`.
 * - Operations (open, mutations, undo, redo) run strictly FIFO; reads are synchronous and see committed state only.
 * - Model ids carry `@<generation>`; an id from an older generation is rejected with STALE_ID, never resolved to
 *   whatever object now sits at that position.
 * - Dirty state is state identity, not generation or bytes: undo/redo restore the identity of the state they load.
 * - The session never hands out its internal byte arrays or mutable model; `bytes` is a copy, `getPage()` is frozen.
 */
export class EditorSession {
  private raw: EditorEngine;
  private engine: EditorEngine;
  private cur: Committed = emptyState();
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private _status: SessionStatus = "empty";
  private _generation = 0;
  private stateSeq = 0;
  private cleanStateId = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private inEngine = false;
  private disposal?: Promise<void>;

  constructor(opts: { engineFactory?: () => EditorEngine } = {}) {
    this.raw = (opts.engineFactory ?? (() => new PdfEditorEngine()))();
    // shortcut: reentrancy is detected only for calls made synchronously inside an engine call; a call made after an
    // await inside an engine method would deadlock the queue. Engines must never call back into the session.
    this.engine = new Proxy(this.raw, {
      get: (t, k) => {
        const v = Reflect.get(t, k);
        if (typeof v !== "function") return v;
        return (...a: unknown[]) => { this.inEngine = true; try { return v.apply(t, a); } finally { this.inEngine = false; } };
      },
    });
  }

  // ---- state (synchronous, committed state only) ------------------------------------------

  get status(): SessionStatus { return this._status; }
  /** Id-stamp scope of the current model. Increments on every committed mutation/undo/redo; never reused or restored. */
  get generation(): number { return this._generation; }
  /** True when the current document state differs from the clean state (set at open, moved by `markClean()`). */
  get isDirty(): boolean { return this.cur.stateId !== this.cleanStateId; }
  get history(): { undoDepth: number; redoDepth: number; limit: number } { return { undoDepth: this.past.length, redoDepth: this.future.length, limit: MAX_HISTORY }; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get pageCount(): number { return this.cur.pageCount; }
  /** A copy of the committed document bytes: safe to keep, transfer or mutate. */
  get bytes(): Uint8Array { return this.cur.bytes.slice(); }

  getPage(pageIndex: number): DeepReadonly<LayahPage> {
    this.checkPage(pageIndex);
    return this.cur.store.getPage(pageIndex) as DeepReadonly<LayahPage>;
  }

  /** Reason a page cannot be edited (e.g. rotated), or undefined if editable. */
  uneditableReason(pageIndex: number): string | undefined {
    this.checkPage(pageIndex);
    return this.cur.uneditable.get(pageIndex);
  }

  /** Declare the current state the clean one (e.g. after saving). */
  markClean(): void { this.cleanStateId = this.cur.stateId; }

  // ---- lifecycle ---------------------------------------------------------------------------

  /** Open once, from `empty`. Copies `bytes` unless `transfer` is set (the caller then must not touch the array again). */
  open(bytes: Uint8Array, wasmBinary?: ArrayBuffer, opts: { transfer?: boolean } = {}): Promise<void> {
    return this.enqueue(async () => {
      if (this._status === "disposed") throw this.err("DISPOSED", "This editing session has been closed.");
      if (this._status !== "empty") throw this.err("ALREADY_OPEN", "This session already has a document open.");
      if (!(bytes instanceof Uint8Array)) throw this.err("INVALID_ARGUMENT", "bytes must be a Uint8Array.", { param: "bytes" });
      const input = opts.transfer ? bytes : bytes.slice();
      let built!: Committed;
      try {
        await this.engine.initialize(wasmBinary);
        await this.engine.load(input);
        built = await this.build(input, this._generation + 1);
        this.alive();
      } catch (e) {
        try { this.raw.dispose(); } catch { /* nothing loaded */ }
        if (e instanceof EditorSessionError) throw e;
        const password = e instanceof EngineError && e.kind === "password";
        throw new EditorSessionError(password ? "PASSWORD_REQUIRED" : "OPEN_FAILED", e instanceof Error ? e.message : "This PDF could not be opened.", { cause: e });
      }
      built.stateId = ++this.stateSeq;
      this.past = [];
      this.future = [];
      this.install(built);
      this.cleanStateId = built.stateId;
      this._status = "ready";
    });
  }

  /**
   * Terminal and idempotent. The status flips at once: queued operations reject DISPOSED, an in-flight one finishes
   * its current engine step but its result is discarded. The engine is freed after in-flight work settles.
   * Reads of the last committed model keep working.
   */
  dispose(): Promise<void> {
    if (!this.disposal) {
      this._status = "disposed";
      this.disposal = this.tail.then(() => { try { this.raw.dispose(); } catch { /* already gone */ } this.cur.ptrs.clear(); });
    }
    return this.disposal;
  }

  // ---- pure reads --------------------------------------------------------------------------

  /** Resolve derived run/block ids (or source ids) to the underlying source object ids. */
  resolveSourceIds(pageIndex: number, ids: string[]): string[] {
    this.checkPage(pageIndex);
    return this.resolve(pageIndex, ids);
  }

  /** Smallest layout ids (runs, else the object itself) covering the given source ids. */
  layoutIdsFor(pageIndex: number, sourceIds: string[]): string[] {
    this.checkPage(pageIndex);
    const page = this.cur.store.getPage(pageIndex)!;
    for (const s of this.idList(sourceIds)) if (!page.objects[s]) throw this.err("STALE_ID", `Object ${s} is not in the current document.`, { reason: "unknown", id: s });
    return this.layoutIdsIn(pageIndex, sourceIds);
  }

  /** Honest pre-edit warning for the text editing UI, or null if none applies. */
  textEditWarning(pageIndex: number, id: string): string | null {
    this.checkPage(pageIndex);
    const page = this.cur.store.getPage(pageIndex)!;
    const objs = this.resolve(pageIndex, [id]).map(s => page.objects[s]).filter((o): o is LayahTextObject => o?.type === "text");
    const notes: string[] = [];
    if (objs.some(o => /^[A-Z]{6}\+/.test(o.fontFamily ?? ""))) notes.push("This text uses an embedded subset font, so new characters that the original text didn't use may not display.");
    if (objs.length > 1) notes.push(`This line is stored as ${objs.length} separate pieces; they will be merged into one.`);
    notes.push("The new text keeps the original font and size and may be wider or narrower than before.");
    return notes.join(" ");
  }

  // ---- mutations ---------------------------------------------------------------------------

  /** Move (in PDF points; +y is up). Group moves resolve every underlying source object. */
  move(pageIndex: number, ids: string[], dx: number, dy: number): Promise<string[]> {
    return this.enqueue(async () => {
      const src = this.prepare(pageIndex, ids);
      this.finite({ dx, dy });
      await this.transact(async () => { for (const s of src) await this.engine.moveObject(pageIndex, this.ptr(s), dx, dy); });
      return this.layoutIdsAfter(pageIndex, src);
    });
  }

  remove(pageIndex: number, ids: string[]): Promise<void> {
    return this.enqueue(async () => {
      const src = this.prepare(pageIndex, ids);
      await this.transact(async () => {
        for (const s of src) { await this.engine.deleteObject(pageIndex, this.ptr(s)); this.cur.ptrs.delete(s); }
      });
    });
  }

  /**
   * Replace the text of a run/object. The new text goes into the first underlying text object
   * (reading order); any further fragments of the run are removed so the old text doesn't show through.
   *
   * PDFium silently drops characters the original (usually subsetted) font has no glyph for, so the
   * result is verified after reload. If characters were lost the edit is rolled back and a
   * FontCoverageError is thrown; retry with { substituteFont: true } to replace the text with
   * Helvetica at the same position, size and colour instead.
   */
  replaceText(pageIndex: number, id: string, text: string, opts: { substituteFont?: boolean } = {}): Promise<{ ids: string[]; substituted: boolean }> {
    return this.enqueue(async () => {
      this.readyPage(pageIndex);
      if (typeof text !== "string") throw this.err("INVALID_ARGUMENT", "text must be a string.", { param: "text" });
      const page = this.cur.store.getPage(pageIndex)!;
      const src = this.resolve(pageIndex, [id]).filter(s => page.objects[s]?.type === "text");
      if (!src.length) throw this.err("NOTHING_TO_DO", "Selection contains no editable text.");
      const first = page.objects[src[0]] as LayahTextObject;
      const near = (o: LayahSourceObject) => Math.abs(o.bounds.left - first.bounds.left) < 2 && Math.abs(o.bounds.bottom - first.bounds.bottom) < Math.max(4, (first.fontSize ?? 12));

      if (opts.substituteFont) {
        const size = first.fontSize ?? 12;
        const color = this.engine.getFillColor(this.ptr(src[0])) ?? [0, 0, 0];
        await this.transact(async () => {
          for (const s of src) { await this.engine.deleteObject(pageIndex, this.ptr(s)); this.cur.ptrs.delete(s); }
          // PDFium text origin is the baseline; the bounds bottom sits roughly 0.2em below it.
          await this.engine.addText(pageIndex, { text, x: first.bounds.left, y: first.bounds.bottom + size * 0.2, fontSize: size, fontFamily: "Helvetica", color });
        });
        const last = Object.values(this.cur.store.getPage(pageIndex)!.objects).filter(o => o.type === "text").pop();
        return { ids: last ? this.layoutIdsIn(pageIndex, [last.id]) : [], substituted: true };
      }

      await this.transact(
        async () => {
          await this.engine.replaceText(pageIndex, this.ptr(src[0]), text);
          for (const s of src.slice(1)) { await this.engine.deleteObject(pageIndex, this.ptr(s)); this.cur.ptrs.delete(s); }
        },
        store => {
          const objs = Object.values(store.getPage(pageIndex)!.objects).filter((o): o is LayahTextObject => o.type === "text" && near(o));
          const want = text.trim();
          if (objs.some(o => o.text.trim() === want)) return;
          const got = new Set(objs.map(o => o.text).join(""));
          const missing = [...new Set(text)].filter(c => c.trim() && !got.has(c));
          throw new FontCoverageError(first.fontFamily, missing);
        }
      );
      const hit = Object.values(this.cur.store.getPage(pageIndex)!.objects).find((o): o is LayahTextObject => o.type === "text" && o.text.trim() === text.trim() && near(o));
      return { ids: hit ? this.layoutIdsIn(pageIndex, [hit.id]) : [], substituted: false };
    });
  }

  addText(pageIndex: number, o: PdfTextOptions): Promise<string[]> {
    return this.add(pageIndex, "text", () => this.engine.addText(pageIndex, o), { x: o.x, y: o.y });
  }

  addImage(pageIndex: number, o: PdfImageOptions): Promise<string[]> {
    return this.add(pageIndex, "image", () => this.engine.addImage(pageIndex, o), { x: o.x, y: o.y, width: o.width, height: o.height });
  }

  /** Rectangles are written to the page but are not selectable afterwards (path objects aren't modelled). */
  addRect(pageIndex: number, o: PdfRectOptions): Promise<void> {
    return this.enqueue(async () => {
      this.readyPage(pageIndex);
      this.finite({ x: o.x, y: o.y, width: o.width, height: o.height });
      await this.transact(async () => { await this.engine.addRect(pageIndex, o); });
    });
  }

  /** Scale/translate an object (image or text) so its bounds become `to`. */
  resize(pageIndex: number, id: string, to: LayahObjectBounds): Promise<string[]> {
    return this.enqueue(async () => {
      this.readyPage(pageIndex);
      this.finite({ left: to?.left, right: to?.right, top: to?.top, bottom: to?.bottom });
      const src = this.resolve(pageIndex, [id]);
      const page = this.cur.store.getPage(pageIndex)!;
      if (src.length !== 1 || !page.objects[src[0]]) throw this.err("INVALID_ARGUMENT", "Only a single object can be resized.", { param: "id" });
      const b = page.objects[src[0]].bounds;
      const w = b.right - b.left, h = b.top - b.bottom;
      if (w <= 0 || h <= 0 || to.right - to.left < 1 || to.top - to.bottom < 1) throw this.err("INVALID_ARGUMENT", "Invalid size.", { param: "to" });
      const sx = (to.right - to.left) / w, sy = (to.top - to.bottom) / h;
      await this.transact(async () => {
        await this.engine.transformObject(pageIndex, this.ptr(src[0]), { a: sx, b: 0, c: 0, d: sy, e: to.left - b.left * sx, f: to.bottom - b.bottom * sy });
      });
      return this.layoutIdsAfter(pageIndex, src);
    });
  }

  undo(): Promise<boolean> { return this.enqueue(() => this.step(this.past, this.future)); }
  redo(): Promise<boolean> { return this.enqueue(() => this.step(this.future, this.past)); }

  // ---- queue and guards --------------------------------------------------------------------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inEngine) return Promise.reject(this.err("REENTRANT_CALL", "The session was called from inside one of its own engine calls."));
    const run = this.tail.then(fn);
    this.tail = run.then(() => undefined, () => undefined); // a failed operation never poisons the queue
    return run;
  }

  private err(code: ConstructorParameters<typeof EditorSessionError>[0], message: string, details?: Record<string, unknown>) {
    return new EditorSessionError(code, message, { details });
  }

  /** Throws unless the session can run engine-backed work. Checked when an operation executes, not when it is queued. */
  private ready(): void {
    if (this._status === "disposed") throw this.err("DISPOSED", "This editing session has been closed.");
    if (this._status === "faulted") throw this.err("SESSION_FAULTED", "The editing session hit an unrecoverable error. Download your last good copy and reopen the file.");
    if (this._status === "empty") throw this.err("NOT_OPEN", "No document is open.");
  }

  /** Mid-operation check: a disposed session discards in-flight results. */
  private alive(): void {
    if (this._status === "disposed") throw this.err("DISPOSED", "This editing session was closed during the operation.");
  }

  private checkPage(pageIndex: number): void {
    if (this.cur.pageCount === 0 && this._status === "empty") throw this.err("NOT_OPEN", "No document is open.");
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.cur.pageCount) {
      throw this.err("INVALID_ARGUMENT", `Page ${pageIndex} does not exist (document has ${this.cur.pageCount}).`, { param: "pageIndex", value: pageIndex });
    }
  }

  private readyPage(pageIndex: number): void {
    this.ready();
    this.checkPage(pageIndex);
    const reason = this.cur.uneditable.get(pageIndex);
    if (reason) throw this.err("UNEDITABLE_PAGE", reason, { pageIndex });
  }

  private prepare(pageIndex: number, ids: string[]): string[] {
    this.readyPage(pageIndex);
    const src = this.resolve(pageIndex, ids);
    if (!src.length) throw this.err("NOTHING_TO_DO", "No objects to act on.");
    return src;
  }

  private finite(values: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(values)) {
      if (typeof v !== "number" || !Number.isFinite(v)) throw this.err("INVALID_ARGUMENT", `${k} must be a finite number.`, { param: k });
    }
  }

  // ---- ids ---------------------------------------------------------------------------------

  private idList(ids: unknown): string[] {
    if (!Array.isArray(ids)) throw this.err("INVALID_ARGUMENT", "ids must be an array of strings.", { param: "ids" });
    for (const id of ids) {
      if (typeof id !== "string") throw this.err("INVALID_ARGUMENT", "ids must be an array of strings.", { param: "ids" });
      const m = /@(\d+)$/.exec(id);
      if (!m) throw this.err("INVALID_ARGUMENT", `Malformed object id: ${id}`, { param: "ids", id });
      if (Number(m[1]) !== this.cur.generation) {
        throw this.err("STALE_ID", `Object id ${id} is from an earlier version of the document.`, { reason: "generation", id, idGeneration: Number(m[1]), currentGeneration: this.cur.generation });
      }
    }
    return ids as string[];
  }

  private resolve(pageIndex: number, ids: string[]): string[] {
    const page = this.cur.store.getPage(pageIndex)!;
    const out = new Set<string>();
    for (const id of this.idList(ids)) {
      const run = page.layout.runs[id];
      const block = page.layout.textBlocks[id];
      if (run) run.sourceObjectIds.forEach(s => out.add(s));
      else if (block) {
        for (const lid of block.lineIds) this.cur.lines.get(pageIndex)?.get(lid)?.sourceObjectIds.forEach(s => out.add(s));
      } else if (page.objects[id]) out.add(id);
      else throw this.err("STALE_ID", `Object ${id} is not in the current document.`, { reason: "unknown", id });
    }
    return [...out];
  }

  /** Layout ids (runs, else the object itself) covering `sourceIds` in the current model; unknown ids are skipped. */
  private layoutIdsIn(pageIndex: number, sourceIds: string[]): string[] {
    const page = this.cur.store.getPage(pageIndex)!;
    const wanted = new Set(sourceIds);
    const out: string[] = [];
    const covered = new Set<string>();
    for (const run of Object.values(page.layout.runs)) {
      if (run.sourceObjectIds.some(s => wanted.has(s))) {
        out.push(run.id);
        run.sourceObjectIds.forEach(s => covered.add(s));
      }
    }
    for (const s of sourceIds) if (!covered.has(s) && page.objects[s]) out.push(s);
    return out;
  }

  /** After a commit: the same objects (by position) under the new generation's stamp. */
  private layoutIdsAfter(pageIndex: number, src: string[]): string[] {
    return this.layoutIdsIn(pageIndex, restamp(src, this.cur.generation));
  }

  private ptr(sourceId: string): string {
    const p = this.cur.ptrs.get(sourceId);
    if (!p) throw this.err("STALE_ID", `Object ${sourceId} is no longer part of the document.`, { reason: "unknown", id: sourceId });
    return p;
  }

  private add(pageIndex: number, type: "text" | "image", create: () => Promise<string>, nums: Record<string, unknown>): Promise<string[]> {
    return this.enqueue(async () => {
      this.readyPage(pageIndex);
      this.finite(nums);
      await this.transact(async () => { await create(); });
      // The new object is last in content order, hence has the highest per-type counter.
      const last = Object.values(this.cur.store.getPage(pageIndex)!.objects).filter(o => o.type === type).pop();
      return last ? this.layoutIdsIn(pageIndex, [last.id]) : [];
    });
  }

  // ---- transactions ------------------------------------------------------------------------

  /** apply -> export -> reload + stage -> verify -> atomic commit. Any failure rolls back; see `recover`. */
  private async transact(apply: () => Promise<void>, verify?: (store: LayahDocumentStore) => void): Promise<void> {
    const prior = this.cur;
    let phase: Phase = "apply";
    let built!: Committed;
    try {
      await apply();
      this.alive();
      phase = "export";
      const out = await this.engine.export();
      this.alive();
      phase = "reload";
      await this.engine.load(out);
      built = await this.build(out, this._generation + 1);
      this.alive();
      phase = "verify";
      verify?.(built.store);
    } catch (e) {
      throw await this.recover(e, phase);
    }
    built.stateId = ++this.stateSeq;
    this.past.push({ bytes: prior.bytes, stateId: prior.stateId });
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.install(built);
  }

  /** Undo/redo: load the target snapshot, and only on success move the stacks and commit. */
  private async step(from: Snapshot[], to: Snapshot[]): Promise<boolean> {
    this.ready();
    const snap = from[from.length - 1];
    if (!snap) return false;
    const prior = this.cur;
    let built!: Committed;
    try {
      await this.engine.load(snap.bytes);
      built = await this.build(snap.bytes, this._generation + 1);
      this.alive();
    } catch (e) {
      throw await this.recover(e, "reload");
    }
    built.stateId = snap.stateId; // the restored state keeps its identity; the generation is new
    from.pop();
    to.push({ bytes: prior.bytes, stateId: prior.stateId });
    this.install(built);
    return true;
  }

  /** Put the engine back on the committed bytes. Returns the error to throw; a failed rollback faults the session. */
  private async recover(e: unknown, phase: Phase): Promise<Error> {
    if (this._status === "disposed") {
      return e instanceof EditorSessionError && e.code === "DISPOSED" ? e : new EditorSessionError("DISPOSED", "This editing session was closed during the operation.", { cause: e });
    }
    const prior = this.cur;
    try {
      await this.engine.load(prior.bytes);
      prior.ptrs = (await this.build(prior.bytes, prior.generation)).ptrs; // same bytes, same generation: ids are unchanged
    } catch (re) {
      this._status = "faulted";
      return new EditorSessionError("ROLLBACK_FAILED", "An edit failed and the document could not be restored. Download your last good copy and reopen the file.", { cause: e, details: { phase, rollbackCause: re } });
    }
    if (e instanceof EditorSessionError) return e;
    return new EditorSessionError("ENGINE_FAILURE", `The edit could not be completed (${phase}): ${e instanceof Error ? e.message : String(e)}`, { cause: e, details: { phase } });
  }

  private install(c: Committed): void {
    Object.values(c.store.getDocument().pages).forEach(p => deepFreeze(p));
    this.cur = c;
    this._generation = c.generation;
  }

  /** Build the model for the document currently loaded in the engine, stamping every id with `gen`. */
  private async build(bytes: Uint8Array, gen: number): Promise<Committed> {
    const ptrs = new Map<string, string>();
    const lines = new Map<number, Map<string, LayahTextLine>>();
    const uneditable = new Map<number, string>();
    const store = new LayahDocumentStore();
    const mapper = new PdfToLayahMapper();
    const n = await this.engine.getPageCount();
    for (let i = 0; i < n; i++) {
      const info = await this.engine.inspectPage(i);
      const page: LayahPage = { id: `page-${i}`, pageIndex: i, width: info.width, height: info.height, objects: {}, layout: { textBlocks: {}, runs: {} } };
      store.addPage(page);
      if (info.rotation !== 0) { uneditable.set(i, "This page is rotated; editing rotated pages isn't supported yet."); continue; }
      const objs = await this.engine.getEditableObjects(i);
      const sources: LayahSourceObject[] = objs.map(o => {
        const m = mapper.mapObject(o);
        m.id = stampOf(m.id, gen);
        ptrs.set(m.id, o.id);
        if (m.type === "text" && o.type === "text") (m as LayahTextObject).fontFamily = o.fontName;
        return m;
      });
      sources.forEach(o => store.addObject(i, o));
      const text = sources.filter((o): o is LayahTextObject => o.type === "text" && o.text.trim().length > 0);
      const geoms = text.map(deriveTextGeometry);
      const ls = inferTextLines(geoms, getReadingOrder(text)); // line ids embed the stamped object id, so they are stamped too
      lines.set(i, new Map(ls.map(l => [l.id, l])));
      inferTextRuns(ls, geoms).forEach(r => { r.id = stampOf(r.id, gen); page.layout.runs[r.id] = r; });
      inferTextBlocks(ls).forEach(b => { b.id = stampOf(b.id, gen); page.layout.textBlocks[b.id] = b; });
    }
    return { bytes, stateId: 0, generation: gen, store, ptrs, lines, uneditable, pageCount: n };
  }
}
