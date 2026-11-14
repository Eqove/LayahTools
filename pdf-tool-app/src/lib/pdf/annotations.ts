import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from "pdf-lib";

/**
 * Read-only annotation inspection and comparison (pdf-lib). It reads annotation dictionaries; it does not render them.
 *
 * Not inspected (documented limits): appearance-stream content, rich text (/RC), popup geometry, replies (/IRT),
 * annotation actions other than a URI. Pixel-level changes are covered by the render diff in the regression harness.
 */

export type AnnotationRect = [number, number, number, number];

export interface AnnotationInfo {
  pageIndex: number;
  /** Position inside the page's /Annots array. */
  index: number;
  subtype: string;
  rect: AnnotationRect | null;
  contents: string | null;
  /** /NM unique name when the producer set one. */
  name: string | null;
  /** /C colour components (grey, RGB or CMYK), or null. */
  color: number[] | null;
  flags: number;
  quadPointCount: number;
  inkPathCount: number;
  hasAppearance: boolean;
  hasPopup: boolean;
  /** URI of a link action, when present. */
  uri: string | null;
  /** Fully qualified AcroForm field name for widgets. */
  fieldName: string | null;
}

export interface AnnotationInspection {
  /** One array per page, in page order. */
  pages: AnnotationInfo[][];
  total: number;
  byType: Record<string, number>;
  /** /Annots entries that do not resolve to a dictionary. */
  dangling: number;
}

const text = (o: PDFObject | undefined): string | null => {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  return null;
};

const numbers = (o: PDFObject | undefined): number[] | null => {
  if (!(o instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < o.size(); i++) {
    const n = o.lookup(i);
    if (!(n instanceof PDFNumber)) return null;
    out.push(n.asNumber());
  }
  return out;
};

const round = (n: number) => Math.round(n * 100) / 100;

function fieldNameOf(dict: PDFDict): string | null {
  const parts: string[] = [];
  let cur: PDFDict | undefined = dict;
  for (let guard = 0; cur && guard < 32; guard++) {
    const t = text(cur.lookup(PDFName.of("T")));
    if (t) parts.unshift(t);
    cur = cur.lookupMaybe(PDFName.of("Parent"), PDFDict);
  }
  return parts.length ? parts.join(".") : null;
}

function describe(dict: PDFDict, pageIndex: number, index: number): AnnotationInfo {
  const rectNums = numbers(dict.lookup(PDFName.of("Rect")));
  const rect = rectNums && rectNums.length === 4 ? ([round(rectNums[0]), round(rectNums[1]), round(rectNums[2]), round(rectNums[3])] as AnnotationRect) : null;
  const quads = numbers(dict.lookup(PDFName.of("QuadPoints")));
  const ink = dict.lookup(PDFName.of("InkList"));
  const ap = dict.lookup(PDFName.of("AP"));
  let hasAppearance = false;
  if (ap instanceof PDFDict) {
    const n = ap.lookup(PDFName.of("N"));
    hasAppearance = n instanceof PDFStream || n instanceof PDFRawStream || n instanceof PDFDict;
  }
  const flags = dict.lookup(PDFName.of("F"));
  const action = dict.lookupMaybe(PDFName.of("A"), PDFDict);
  const color = numbers(dict.lookup(PDFName.of("C")));
  const subtype = dict.lookup(PDFName.of("Subtype"));
  return {
    pageIndex,
    index,
    subtype: subtype instanceof PDFName ? subtype.decodeText() : "Unknown",
    rect,
    contents: text(dict.lookup(PDFName.of("Contents"))),
    name: text(dict.lookup(PDFName.of("NM"))),
    color: color ? color.map(round) : null,
    flags: flags instanceof PDFNumber ? flags.asNumber() : 0,
    quadPointCount: quads ? Math.floor(quads.length / 8) : 0,
    inkPathCount: ink instanceof PDFArray ? ink.size() : 0,
    hasAppearance,
    hasPopup: dict.lookup(PDFName.of("Popup")) instanceof PDFDict,
    uri: action ? text(action.lookup(PDFName.of("URI"))) : null,
    fieldName: fieldNameOf(dict),
  };
}

/** Lists every annotation per page. Throws when the PDF cannot be opened (corrupt or encrypted): never returns a false "0". */
export async function inspectAnnotations(bytes: Uint8Array | ArrayBuffer): Promise<AnnotationInspection> {
  const doc = await PDFDocument.load(bytes);
  const pages: AnnotationInfo[][] = [];
  const byType: Record<string, number> = {};
  let dangling = 0;
  doc.getPages().forEach((page, pageIndex) => {
    const list: AnnotationInfo[] = [];
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray) {
      for (let i = 0; i < annots.size(); i++) {
        const entry = annots.get(i);
        const dict = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
        if (!(dict instanceof PDFDict)) {
          dangling++;
          continue;
        }
        const info = describe(dict, pageIndex, i);
        list.push(info);
        byType[info.subtype] = (byType[info.subtype] ?? 0) + 1;
      }
    }
    pages.push(list);
  });
  return { pages, total: pages.reduce((n, p) => n + p.length, 0), byType, dangling };
}

export interface AnnotationChange {
  field: keyof AnnotationInfo;
  before: unknown;
  after: unknown;
}

export interface AnnotationDiff {
  ok: boolean;
  countsBefore: Record<string, number>;
  countsAfter: Record<string, number>;
  /** In `before`, absent in `after`, on a page that still exists. */
  missing: AnnotationInfo[];
  added: AnnotationInfo[];
  modified: { name: string | null; subtype: string; pageIndex: number; before: AnnotationInfo; after: AnnotationInfo; changes: AnnotationChange[] }[];
  /** Annotations that left with a page that was deleted on purpose (pageMap entry null). Not a failure. */
  removedWithPage: AnnotationInfo[];
  /** Human-readable lines for the report. */
  messages: string[];
}

export interface CompareOptions {
  /** pageMap[i] = output page index of source page i, or null when the page was removed on purpose. Default identity. */
  pageMap?: (number | null)[];
}

const COMPARED: (keyof AnnotationInfo)[] = ["subtype", "rect", "contents", "color", "flags", "quadPointCount", "inkPathCount", "hasAppearance", "hasPopup", "uri", "fieldName"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Identity of an annotation across a copy: /NM when set, otherwise subtype + rect (a moved unnamed annotation reads as missing + added). */
function keyOf(a: AnnotationInfo): string {
  return a.name ? `nm:${a.name}` : `${a.subtype}@${a.rect ? a.rect.join(",") : "norect"}`;
}

function keyed(list: AnnotationInfo[]): Map<string, AnnotationInfo> {
  const m = new Map<string, AnnotationInfo>();
  const seen = new Map<string, number>();
  for (const a of list) {
    const base = keyOf(a);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    m.set(n === 0 ? base : `${base}#${n}`, a);
  }
  return m;
}

const label = (a: AnnotationInfo) => `${a.subtype}${a.name ? ` "${a.name}"` : ""} on page ${a.pageIndex + 1}`;

export function compareAnnotations(before: AnnotationInspection, after: AnnotationInspection, options: CompareOptions = {}): AnnotationDiff {
  const map = options.pageMap ?? before.pages.map((_, i) => i);
  const missing: AnnotationInfo[] = [];
  const added: AnnotationInfo[] = [];
  const removedWithPage: AnnotationInfo[] = [];
  const modified: AnnotationDiff["modified"] = [];
  const matchedAfterPages = new Set<number>();

  before.pages.forEach((list, src) => {
    const dest = map[src];
    if (dest === null || dest === undefined) {
      removedWithPage.push(...list);
      return;
    }
    matchedAfterPages.add(dest);
    const b = keyed(list);
    const a = keyed(after.pages[dest] ?? []);
    for (const [k, ba] of b) {
      const aa = a.get(k);
      if (!aa) {
        missing.push(ba);
        continue;
      }
      a.delete(k);
      const changes: AnnotationChange[] = [];
      for (const f of COMPARED) if (!same(ba[f], aa[f])) changes.push({ field: f, before: ba[f], after: aa[f] });
      if (changes.length) modified.push({ name: ba.name, subtype: ba.subtype, pageIndex: dest, before: ba, after: aa, changes });
    }
    added.push(...a.values());
  });
  // Output pages that no source page maps to: everything on them is new.
  after.pages.forEach((list, dest) => {
    if (!matchedAfterPages.has(dest)) added.push(...list);
  });

  const messages: string[] = [];
  for (const a of missing) messages.push(`missing: ${label(a)}`);
  for (const a of added) messages.push(`added: ${label(a)}`);
  for (const m of modified) messages.push(`modified: ${m.subtype}${m.name ? ` "${m.name}"` : ""} on page ${m.pageIndex + 1} (${m.changes.map((c) => `${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`).join("; ")})`);
  if (after.dangling > before.dangling) messages.push(`dangling annotation references increased: ${before.dangling} -> ${after.dangling}`);

  return {
    ok: !missing.length && !added.length && !modified.length && after.dangling <= before.dangling,
    countsBefore: before.byType,
    countsAfter: after.byType,
    missing,
    added,
    modified,
    removedWithPage,
    messages,
  };
}
