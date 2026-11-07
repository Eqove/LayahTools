/**
 * Interface-level engine double for EditorSession contract tests: counts calls, injects failures, pauses calls and
 * lets a test hook into a call. It wraps only the public `EditorEngine` interface, so it needs no private access and
 * no raw PDFium instrumentation (that stays in mutation-probe.ts for the B-1.1 invariants).
 */
import { PdfEditorEngine } from "../../src/lib/pdf/editor/engine";
import type { EditorEngine } from "../../src/lib/pdf/editor/engine-contract";

const SYNC = new Set(["getFillColor", "dispose"]);

export interface Doubles {
  factory: () => EditorEngine;
  /** Calls per engine method since creation or the last reset(). */
  counts: Record<string, number>;
  reset(): void;
  /** Fail calls of `method` for which pred(n) holds; n counts that method's calls since arming (1-based). */
  arm(method: keyof EditorEngine, pred: (n: number) => boolean, error?: Error): Error;
  disarm(): void;
  /** Hold the next call of `method` until release(); `reached` resolves when the call arrives. */
  gate(method: keyof EditorEngine): { reached: Promise<void>; release: () => void };
  /** Runs synchronously at the start of every engine call (use to simulate a misbehaving engine). */
  hook?: (method: string) => void;
}

export function doubleEngine(inner: () => EditorEngine = () => new PdfEditorEngine()): Doubles {
  const counts: Record<string, number> = {};
  const rules = new Map<string, { n: number; pred: (n: number) => boolean; error: Error }>();
  const gates = new Map<string, { reached: () => void; wait: Promise<void> }>();
  const d: Doubles = {
    counts,
    reset: () => { for (const k of Object.keys(counts)) delete counts[k]; },
    arm(method, pred, error = new Error(`injected ${String(method)} failure`)) { rules.set(method, { n: 0, pred, error }); return error; },
    disarm: () => rules.clear(),
    gate(method) {
      let release!: () => void, reached!: () => void;
      const wait = new Promise<void>(r => (release = r));
      const arrived = new Promise<void>(r => (reached = r));
      gates.set(method, { reached, wait });
      return { reached: arrived, release };
    },
    factory: () => new Proxy(inner(), {
      get(target, key) {
        const fn = Reflect.get(target, key);
        if (typeof fn !== "function" || typeof key !== "string") return fn;
        return (...args: unknown[]) => {
          counts[key] = (counts[key] ?? 0) + 1;
          d.hook?.(key);
          const rule = rules.get(key);
          if (rule && (++rule.n, rule.pred(rule.n))) { if (SYNC.has(key)) throw rule.error; return Promise.reject(rule.error); }
          const gate = gates.get(key);
          if (gate) { gates.delete(key); gate.reached(); return gate.wait.then(() => fn.apply(target, args)); }
          return fn.apply(target, args);
        };
      },
    }),
  };
  return d;
}
