/**
 * Test-only mutation instrumentation for EditorSession (reusable by any regression runner).
 * No production code is changed: it wraps methods on the session's engine instance and on the raw PDFium bindings.
 * It reaches `session.engine`, `session.past` and `session.future`, which are TypeScript-private but plain runtime
 * properties; if they are ever renamed this throws immediately instead of silently counting nothing.
 *
 * Two independent layers are counted so one can cross-check the other:
 *  - engine.*   : PdfEditorEngine method calls (replaceText, moveObject, transformObject, deleteObject, addText,
 *                 addImage, addRect, export, load)
 *  - pdfium.*   : raw PDFium calls that change or serialise the document (GenerateContent, Transform, RemoveObject,
 *                 InsertObject, SetText, SaveAsCopy, LoadMemDocument, CloseDocument)
 * plus session.generation (bumps on every reload), history length (past/future) and document byte identity.
 */

const ENGINE_METHODS = ["replaceText", "moveObject", "transformObject", "deleteObject", "addText", "addImage", "addRect", "export", "load"];
const PDFIUM_FUNCTIONS = [
  "FPDFPage_GenerateContent", "FPDFPageObj_Transform", "FPDFPage_RemoveObject", "FPDFPage_InsertObject",
  "FPDFText_SetText", "FPDF_SaveAsCopy", "FPDF_LoadMemDocument", "FPDF_CloseDocument",
];

export interface Snapshot {
  counters: Record<string, number>;
  generation: number;
  past: number;
  future: number;
  bytes: Uint8Array;
}

export interface Probe {
  snapshot(): Snapshot;
  /** Human-readable list of everything that differs between two snapshots; empty means "nothing changed". */
  diff(a: Snapshot, b: Snapshot): string[];
  /** Runs `fn`, then throws if anything changed. */
  assertUnchanged(label: string, fn: () => unknown | Promise<unknown>): Promise<void>;
}

export function instrumentSession(session: any): Probe {
  const counters: Record<string, number> = {};
  const wrap = (obj: any, name: string, key: string) => {
    if (typeof obj?.[name] !== "function") throw new Error(`mutation-probe: ${key} not found (internals changed?)`);
    const orig = obj[name].bind(obj);
    obj[name] = (...args: unknown[]) => { counters[key] = (counters[key] ?? 0) + 1; return orig(...args); };
  };
  const engine = session.engine;
  if (!engine || !engine.pdfium || !Array.isArray(session.past) || !Array.isArray(session.future)) {
    throw new Error("mutation-probe: EditorSession internals (engine/past/future) changed");
  }
  for (const m of ENGINE_METHODS) wrap(engine, m, `engine.${m}`);
  for (const f of PDFIUM_FUNCTIONS) wrap(engine.pdfium, f, `pdfium.${f}`);

  const snapshot = (): Snapshot => ({
    counters: { ...counters },
    generation: session.generation,
    past: session.past.length,
    future: session.future.length,
    bytes: session.bytes,
  });
  const diff = (a: Snapshot, b: Snapshot) => {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(a.counters), ...Object.keys(b.counters)])) {
      if ((a.counters[k] ?? 0) !== (b.counters[k] ?? 0)) out.push(`${k}: ${a.counters[k] ?? 0} -> ${b.counters[k] ?? 0}`);
    }
    if (a.generation !== b.generation) out.push(`generation: ${a.generation} -> ${b.generation}`);
    if (a.past !== b.past) out.push(`history(past): ${a.past} -> ${b.past}`);
    if (a.future !== b.future) out.push(`history(future): ${a.future} -> ${b.future}`);
    if (a.bytes !== b.bytes) out.push("document bytes: replaced");
    return out;
  };
  return {
    snapshot,
    diff,
    async assertUnchanged(label, fn) {
      const before = snapshot();
      await fn();
      const changes = diff(before, snapshot());
      if (changes.length) throw new Error(`${label}: document was mutated (${changes.join("; ")})`);
    },
  };
}
