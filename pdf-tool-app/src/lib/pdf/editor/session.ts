import { PdfEditorEngine } from "./engine";
import type { PdfImageOptions, PdfRectOptions, PdfTextOptions } from "./types";
import { PdfToLayahMapper } from "../../document/mapper";
import { deriveTextGeometry, getReadingOrder } from "../../document/geometry";
import { inferTextLines, LayahTextLine } from "../../document/lines";
import { inferTextRuns } from "../../document/runs";
import { inferTextBlocks } from "../../document/blocks";
import { LayahDocumentStore } from "../../document/store";
import type { LayahObjectBounds, LayahPage, LayahSourceObject, LayahTextObject } from "../../document/types";

const MAX_HISTORY = 20;

/** Thrown (after rolling back) when the original font lacks glyphs for some of the new text. */
export class FontCoverageError extends Error {
  constructor(public fontName: string | undefined, public missing: string[]) {
    super(`The original font${fontName ? ` (${fontName.replace(/^[A-Z]{6}\+/, "")})` : ""} doesn't contain: ${missing.join(" ") || "some of these characters"}.`);
    this.name = "FontCoverageError";
  }
}

/**
 * One open document being edited. Owns the PDFium engine, the derived Layah model,
 * the transient (model id -> native pointer) map, and the undo/redo history.
 *
 * Every mutation is a transaction: apply to PDFium -> export -> reload from the exported
 * bytes -> rebuild model + pointer map. Because the pointer map and all PDFium page handles
 * are rebuilt on every reload, a native pointer can never outlive the document it came from.
 * History is a stack of exported byte snapshots (bounded), so undo/redo is exactly
 * "reload an earlier snapshot" and cannot drift from the real file.
 */
export class EditorSession {
  private engine = new PdfEditorEngine();
  private ptrs = new Map<string, string>();
  private lines = new Map<number, Map<string, LayahTextLine>>();
  private past: Uint8Array[] = [];
  private future: Uint8Array[] = [];
  private _bytes: Uint8Array = new Uint8Array();
  private _store = new LayahDocumentStore();
  private uneditable = new Map<number, string>();

  /** Bumped on every reload; lets the UI discard async results from an older document. */
  generation = 0;

  get bytes(): Uint8Array { return this._bytes; }
  get store(): LayahDocumentStore { return this._store; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /** Reason a page cannot be edited (e.g. rotated), or undefined if editable. */
  uneditableReason(pageIndex: number): string | undefined { return this.uneditable.get(pageIndex); }

  async open(bytes: Uint8Array, wasmBinary?: ArrayBuffer): Promise<void> {
    await this.engine.initialize(wasmBinary);
    this.past = [];
    this.future = [];
    await this.reload(bytes);
  }

  dispose(): void { this.engine.dispose(); this.ptrs.clear(); }

  // ---- id resolution ---------------------------------------------------------------------

  /** Resolve derived run/block ids (or source ids) to the underlying source object ids. */
  resolveSourceIds(pageIndex: number, ids: string[]): string[] {
    const page = this._store.getPage(pageIndex);
    if (!page) return [];
    const out = new Set<string>();
    for (const id of ids) {
      const run = page.layout.runs[id];
      const block = page.layout.textBlocks[id];
      if (run) run.sourceObjectIds.forEach(s => out.add(s));
      else if (block) {
        for (const lid of block.lineIds) this.lines.get(pageIndex)?.get(lid)?.sourceObjectIds.forEach(s => out.add(s));
      } else if (page.objects[id]) out.add(id);
    }
    return [...out];
  }

  /** Smallest layout ids (runs, else the object itself) covering the given source ids. */
  layoutIdsFor(pageIndex: number, sourceIds: string[]): string[] {
    const page = this._store.getPage(pageIndex);
    if (!page) return [];
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

  // ---- mutations -------------------------------------------------------------------------

  /** Move (in PDF points; +y is up). Group moves resolve every underlying source object. */
  async move(pageIndex: number, ids: string[], dx: number, dy: number): Promise<string[]> {
    const src = this.resolveSourceIds(pageIndex, ids);
    if (!src.length) throw new Error("Nothing to move");
    await this.commit(async () => { for (const s of src) await this.engine.moveObject(pageIndex, this.ptr(s), dx, dy); });
    return this.layoutIdsFor(pageIndex, src);
  }

  async remove(pageIndex: number, ids: string[]): Promise<void> {
    const src = this.resolveSourceIds(pageIndex, ids);
    if (!src.length) throw new Error("Nothing to delete");
    await this.commit(async () => {
      for (const s of src) { await this.engine.deleteObject(pageIndex, this.ptr(s)); this.ptrs.delete(s); }
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
  async replaceText(pageIndex: number, id: string, text: string, opts: { substituteFont?: boolean } = {}): Promise<{ ids: string[]; substituted: boolean }> {
    const page = this._store.getPage(pageIndex)!;
    const src = this.resolveSourceIds(pageIndex, [id]).filter(s => page.objects[s]?.type === "text");
    if (!src.length) throw new Error("Selection contains no editable text");
    const first = page.objects[src[0]] as LayahTextObject;
    const near = (o: LayahSourceObject) => Math.abs(o.bounds.left - first.bounds.left) < 2 && Math.abs(o.bounds.bottom - first.bounds.bottom) < Math.max(4, (first.fontSize ?? 12));

    if (opts.substituteFont) {
      const size = first.fontSize ?? 12;
      const color = this.engine.getFillColor(this.ptr(src[0])) ?? [0, 0, 0];
      await this.commit(async () => {
        for (const s of src) { await this.engine.deleteObject(pageIndex, this.ptr(s)); this.ptrs.delete(s); }
        // PDFium text origin is the baseline; the bounds bottom sits roughly 0.2em below it.
        await this.engine.addText(pageIndex, { text, x: first.bounds.left, y: first.bounds.bottom + size * 0.2, fontSize: size, fontFamily: "Helvetica", color });
      });
      const last = Object.values(this._store.getPage(pageIndex)!.objects).filter(o => o.type === "text").pop();
      return { ids: last ? this.layoutIdsFor(pageIndex, [last.id]) : [], substituted: true };
    }

    await this.commit(
      async () => {
        await this.engine.replaceText(pageIndex, this.ptr(src[0]), text);
        for (const s of src.slice(1)) { await this.engine.deleteObject(pageIndex, this.ptr(s)); this.ptrs.delete(s); }
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
    const hit = Object.values(this._store.getPage(pageIndex)!.objects).find((o): o is LayahTextObject => o.type === "text" && o.text.trim() === text.trim() && near(o));
    return { ids: hit ? this.layoutIdsFor(pageIndex, [hit.id]) : [], substituted: false };
  }

  /** Honest pre-edit warning for the text editing UI, or null if none applies. */
  textEditWarning(pageIndex: number, id: string): string | null {
    const page = this._store.getPage(pageIndex);
    if (!page) return null;
    const objs = this.resolveSourceIds(pageIndex, [id]).map(s => page.objects[s]).filter((o): o is LayahTextObject => o?.type === "text");
    const notes: string[] = [];
    if (objs.some(o => /^[A-Z]{6}\+/.test(o.fontFamily ?? ""))) notes.push("This text uses an embedded subset font, so new characters that the original text didn't use may not display.");
    if (objs.length > 1) notes.push(`This line is stored as ${objs.length} separate pieces; they will be merged into one.`);
    notes.push("The new text keeps the original font and size and may be wider or narrower than before.");
    return notes.join(" ");
  }

  async addText(pageIndex: number, o: PdfTextOptions): Promise<string[]> {
    return this.add(pageIndex, "text", () => this.engine.addText(pageIndex, o));
  }

  async addImage(pageIndex: number, o: PdfImageOptions): Promise<string[]> {
    return this.add(pageIndex, "image", () => this.engine.addImage(pageIndex, o));
  }

  /** Rectangles are written to the page but are not selectable afterwards (path objects aren't modelled). */
  async addRect(pageIndex: number, o: PdfRectOptions): Promise<void> {
    await this.commit(async () => { await this.engine.addRect(pageIndex, o); });
  }

  /** Scale/translate an object (image or text) so its bounds become `to`. */
  async resize(pageIndex: number, id: string, to: LayahObjectBounds): Promise<string[]> {
    const src = this.resolveSourceIds(pageIndex, [id]);
    const page = this._store.getPage(pageIndex)!;
    if (src.length !== 1 || !page.objects[src[0]]) throw new Error("Only a single object can be resized");
    const b = page.objects[src[0]].bounds;
    const w = b.right - b.left, h = b.top - b.bottom;
    if (w <= 0 || h <= 0 || to.right - to.left < 1 || to.top - to.bottom < 1) throw new Error("Invalid size");
    const sx = (to.right - to.left) / w, sy = (to.top - to.bottom) / h;
    await this.commit(async () => {
      await this.engine.transformObject(pageIndex, this.ptr(src[0]), { a: sx, b: 0, c: 0, d: sy, e: to.left - b.left * sx, f: to.bottom - b.bottom * sy });
    });
    return this.layoutIdsFor(pageIndex, src);
  }

  async undo(): Promise<boolean> {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this._bytes);
    await this.reload(prev);
    return true;
  }

  async redo(): Promise<boolean> {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this._bytes);
    await this.reload(next);
    return true;
  }

  // ---- internals -------------------------------------------------------------------------

  private ptr(sourceId: string): string {
    const p = this.ptrs.get(sourceId);
    if (!p) throw new Error(`Object ${sourceId} is no longer part of the document`);
    return p;
  }

  private async add(pageIndex: number, type: "text" | "image", create: () => Promise<string>): Promise<string[]> {
    await this.commit(async () => { await create(); });
    // The new object is last in content order, hence has the highest per-type counter.
    const page = this._store.getPage(pageIndex)!;
    const last = Object.values(page.objects).filter(o => o.type === type).pop();
    return last ? this.layoutIdsFor(pageIndex, [last.id]) : [];
  }

  /** Apply -> export -> reload. On any failure the last good bytes are reloaded and the error rethrown. */
  private async commit(apply: () => Promise<void>, verify?: (store: LayahDocumentStore) => void): Promise<void> {
    const before = this._bytes;
    try {
      await apply();
      const after = await this.engine.export();
      await this.reload(after);
      verify?.(this._store);
    } catch (e) {
      await this.reload(before);
      throw e;
    }
    this.past.push(before);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  private async reload(bytes: Uint8Array): Promise<void> {
    await this.engine.load(bytes); // disposes old doc + all page handles first
    this._bytes = bytes;
    this.ptrs = new Map();
    this.lines = new Map();
    this.uneditable = new Map();
    this.generation++;
    const store = new LayahDocumentStore();
    const mapper = new PdfToLayahMapper();
    const n = await this.engine.getPageCount();
    for (let i = 0; i < n; i++) {
      const info = await this.engine.inspectPage(i);
      const page: LayahPage = { id: `page-${i}`, pageIndex: i, width: info.width, height: info.height, objects: {}, layout: { textBlocks: {}, runs: {} } };
      store.addPage(page);
      if (info.rotation !== 0) { this.uneditable.set(i, "This page is rotated; editing rotated pages isn't supported yet."); continue; }
      const objs = await this.engine.getEditableObjects(i);
      const sources: LayahSourceObject[] = objs.map(o => {
        const m = mapper.mapObject(o);
        this.ptrs.set(m.id, o.id);
        if (m.type === "text" && o.type === "text") (m as LayahTextObject).fontFamily = o.fontName;
        return m;
      });
      sources.forEach(o => store.addObject(i, o));
      const text = sources.filter((o): o is LayahTextObject => o.type === "text" && o.text.trim().length > 0);
      const geoms = text.map(deriveTextGeometry);
      const lines = inferTextLines(geoms, getReadingOrder(text));
      this.lines.set(i, new Map(lines.map(l => [l.id, l])));
      inferTextRuns(lines, geoms).forEach(r => (page.layout.runs[r.id] = r));
      inferTextBlocks(lines).forEach(b => (page.layout.textBlocks[b.id] = b));
    }
    this._store = store;
  }
}
