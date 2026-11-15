import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PdfViewer } from "@/components/pdf/viewer/PdfViewer";
import { SelectionOverlay } from "./SelectionOverlay";
import { EditorSession, FontCoverageError } from "@/lib/pdf/editor/session";
import { InteractionStateMachine, LayahEditorState } from "@/lib/document/interaction";
import { gestureDown, gestureMove, gestureUp, gestureCancel, selectAllOnPage, hoverTarget } from "@/lib/document/gestures";
import { viewportToPdfPoint, pdfToViewportBounds, PageCoordinateContext } from "@/lib/document/coordinates";
import { downloadBytes } from "@/lib/pdf/download";
import type { LayahObjectBounds, LayahShapeObject, LayahTextObject } from "@/lib/document/types";

interface EditorControllerProps {
  file: File;
  onFileModified: (file: File) => void;
}

type Tool = "select" | "text" | "image" | "whiteout" | "shape";
type ShapeKind = "rect" | "ellipse" | "line" | "arrow";
const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: "rect", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
];
type Placement = { pageIndex: number; x: number; y: number } | null;
interface PendingImage { rgba: Uint8ClampedArray; pw: number; ph: number; name: string }

const ICONS: Record<string, string> = {
  select: "M5 3l14 7-6 2-2 6z",
  text: "M4 6V4h16v2M12 4v16m-3 0h6",
  image: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  whiteout: "M7 21h10M5.5 13.5l7-7a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8l-6 6H9l-3.5-3.5a2 2 0 010-1.5z",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
  line: "M5 19L19 5",
  arrow: "M5 19L19 5M10 5h9v9",
  chevron: "M6 9l6 6 6-6",
  copy: "M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2",
  fill: "M4 6h16v12H4zM8 10h8v4H8z",
  undo: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6",
  redo: "M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6",
  palette: "M12 3a9 9 0 100 18 2 2 0 002-2c0-1-1-1.5-1-2.5s1-1.5 2-1.5h2a3 3 0 003-3C20 7 16.5 3 12 3zM7.5 12h.01M9 8h.01M13 7h.01M16.5 9.5h.01",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
};
const Icon = ({ name }: { name: string }) => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d={ICONS[name]} /></svg>
);
const HINTS: Record<Tool, string> = {
  select: "Select a line to edit, resize, recolour or delete it · drag to move",
  text: "Click on the page where the text should go.",
  image: "Click on the page to place your image.",
  whiteout: "Drag a box over what you want to cover. This only covers it visually; to remove sensitive text, use Redact PDF.",
  shape: "Drag on the page to draw, or just click for a standard-size shape. Click a shape afterwards to resize, recolour, move or delete it.",
};
const SWATCHES = ["#000000", "#4b5563", "#dc2626", "#ea580c", "#16a34a", "#2563eb", "#9333ea", "#ffffff"];
const FAMILIES = ["Helvetica", "Times", "Courier"] as const;
/** Standard-14 PostScript name for a family + weight/slant (what PDFium can create without embedding a font). */
function fontName(family: string, bold: boolean, italic: boolean): string {
  if (family === "Times") return bold ? (italic ? "Times-BoldItalic" : "Times-Bold") : italic ? "Times-Italic" : "Times-Roman";
  const base = family === "Courier" ? "Courier" : "Helvetica";
  return bold ? (italic ? base + "-BoldOblique" : base + "-Bold") : italic ? base + "-Oblique" : base;
}

interface TextActions {
  bold: boolean; italic: boolean; family: string;
  size: (factor: number) => void;
  style: (patch: { bold?: boolean; italic?: boolean; family?: string }) => void;
  color: (hex: string) => void;
}
interface ShapeActions {
  kind: ShapeKind;
  closed: boolean;
  width: number;
  setWidth: (w: number) => void;
  setStroke: (hex: string) => void;
  setFill: (hex: string | null) => void;
  duplicate: () => void;
}
interface SelectionActions { shape: ShapeActions | null; clear: () => void; canEdit: boolean; isImage: boolean; edit: () => void; del: () => void; resize: (factor: number) => void; text: TextActions | null }

const stopProps = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

function TB({ active, danger, className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; danger?: boolean }) {
  return (
    <button type="button" {...p}
      className={`h-8 min-w-8 px-2 flex items-center justify-center text-sm border-r border-blue-100 last:border-r-0 ${active ? "bg-blue-100 text-blue-700" : danger ? "text-red-600 hover:bg-red-50" : "text-blue-600 hover:bg-blue-50"} ${className}`} />
  );
}

/** Colour swatches (optionally with a "no fill" choice). */
function Swatches({ onPick, none }: { onPick: (hex: string | null) => void; none?: boolean }) {
  return (
    <div className="mt-1 inline-flex gap-1.5 bg-white border border-slate-200 rounded-md shadow-lg p-1.5">
      {none && (
        <button type="button" aria-label="No fill" title="No fill" onClick={() => onPick(null)} className="w-6 h-6 rounded-full border border-slate-300 bg-white overflow-hidden">
          <svg viewBox="0 0 24 24" className="w-full h-full"><path d="M4 20L20 4" stroke="#dc2626" strokeWidth="2" /></svg>
        </button>
      )}
      {SWATCHES.map(c => (
        <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => onPick(c)} className="w-6 h-6 rounded-full border border-slate-300" style={{ background: c }} />
      ))}
    </div>
  );
}

/** Floating bar above the selection: only controls that work for what is selected. */
function SelectionBar({ actions, count, style }: { actions: SelectionActions; count: number; style: React.CSSProperties }) {
  const [palette, setPalette] = useState<"text" | "stroke" | "fill" | null>(null);
  const toggle = (p: "text" | "stroke" | "fill") => setPalette(cur => (cur === p ? null : p));
  const t = actions.text;
  const sh = actions.shape;
  return (
    <div {...stopProps} className="absolute z-[60] pointer-events-auto" style={style}>
      <div className="flex flex-wrap items-stretch bg-white border border-blue-400 rounded-md shadow-lg overflow-hidden">
        {count > 1 && <>
          <span className="px-2.5 flex items-center text-xs text-slate-500 border-r border-blue-100">{count} selected</span>
          <TB onClick={actions.clear} title="Deselect everything (Esc)" className="text-xs">Clear</TB>
        </>}
        {actions.canEdit && <TB onClick={actions.edit} title="Edit this text (or double-click it)" className="text-xs font-medium">Edit</TB>}
        {t && <>
          <TB onClick={() => t.size(0.9)} title="Make the text smaller" aria-label="Smaller text"><span className="text-[11px] font-semibold">A</span><span className="text-[9px]">&minus;</span></TB>
          <TB onClick={() => t.size(1.1)} title="Make the text larger" aria-label="Larger text"><span className="text-base font-semibold leading-none">A</span><span className="text-[9px]">+</span></TB>
          <TB active={t.bold} onClick={() => t.style({ bold: !t.bold })} title="Bold (replaces the line with a standard font)" aria-pressed={t.bold} className="font-bold">B</TB>
          <TB active={t.italic} onClick={() => t.style({ italic: !t.italic })} title="Italic (replaces the line with a standard font)" aria-pressed={t.italic} className="italic">I</TB>
          <select value={t.family} onChange={e => t.style({ family: e.target.value })} aria-label="Font" title="Font (replaces the line with a standard font)"
            className="h-8 text-xs text-blue-600 bg-white border-r border-blue-100 px-1.5 focus:outline-none">
            {!t.family && <option value="" disabled>Font</option>}
            {FAMILIES.map(f => <option key={f}>{f}</option>)}
          </select>
          <TB onClick={() => toggle("text")} title="Text colour" aria-label="Text colour" aria-expanded={palette === "text"} active={palette === "text"}>
            <Icon name="palette" />
          </TB>
        </>}
        {sh && <>
          <select value={sh.width} onChange={e => sh.setWidth(Number(e.target.value))} aria-label="Line thickness" title="Line thickness"
            className="h-8 text-xs text-blue-600 bg-white border-r border-blue-100 px-1.5 focus:outline-none">
            {![1, 2, 4, 8].includes(sh.width) && <option value={sh.width}>{Math.round(sh.width * 10) / 10} pt</option>}
            <option value={1}>Thin</option><option value={2}>Medium</option><option value={4}>Thick</option><option value={8}>Extra thick</option>
          </select>
          {sh.closed && (
            <TB onClick={() => toggle("fill")} title="Fill colour" aria-label="Fill colour" aria-expanded={palette === "fill"} active={palette === "fill"}><Icon name="fill" /></TB>
          )}
          <TB onClick={() => toggle("stroke")} title="Outline colour" aria-label="Outline colour" aria-expanded={palette === "stroke"} active={palette === "stroke"}><Icon name="palette" /></TB>
          <TB onClick={sh.duplicate} title="Duplicate" aria-label="Duplicate"><Icon name="copy" /></TB>
        </>}
        {actions.isImage && <>
          <TB onClick={() => actions.resize(0.9)} title="Make the image 10% smaller" className="text-xs">Smaller</TB>
          <TB onClick={() => actions.resize(1.1)} title="Make the image 10% larger" className="text-xs">Larger</TB>
        </>}
        <TB danger onClick={actions.del} title="Delete (Del)" aria-label="Delete"><Icon name="trash" /></TB>
      </div>
      {t && palette === "text" && <Swatches onPick={c => { if (c) t.color(c); setPalette(null); }} />}
      {sh && palette === "stroke" && <Swatches onPick={c => { if (c) sh.setStroke(c); setPalette(null); }} />}
      {sh && palette === "fill" && <Swatches none onPick={c => { sh.setFill(c); setPalette(null); }} />}
    </div>
  );
}

/** New geometry when a resize handle is dragged to `pt` (PDF points). Rect/ellipse handles move edges; line/arrow handles move an end. */
function dragHandle(sh: { kind: string; x1: number; y1: number; x2: number; y2: number }, handle: string, pt: { x: number; y: number }) {
  if (sh.kind === "line" || sh.kind === "arrow") {
    return handle === "p1" ? { x1: pt.x, y1: pt.y, x2: sh.x2, y2: sh.y2 } : { x1: sh.x1, y1: sh.y1, x2: pt.x, y2: pt.y };
  }
  let L = Math.min(sh.x1, sh.x2), R = Math.max(sh.x1, sh.x2), B = Math.min(sh.y1, sh.y2), T = Math.max(sh.y1, sh.y2);
  if (handle.includes("w")) L = pt.x;
  if (handle.includes("e")) R = pt.x;
  if (handle.includes("n")) T = pt.y;
  if (handle.includes("s")) B = pt.y;
  return { x1: L, y1: B, x2: R, y2: T };
}

/** CSS stack that approximates a family so the on-page text box looks like the result. */
const cssFamily = (f: string) => (f === "Times" ? '"Times New Roman", Times, serif' : f === "Courier" ? '"Courier New", Courier, monospace' : "Helvetica, Arial, sans-serif");
const MAX_IMAGE_SIDE = 2000;

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Committed, read-only page of a session, or undefined when the index is not (or no longer) valid. */
const pageOf = (s: EditorSession | null | undefined, i: number | null) => (s && i !== null && i >= 0 && i < s.pageCount ? s.getPage(i) : undefined);

async function decodeImage(file: File): Promise<PendingImage> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const pw = Math.max(1, Math.round(bmp.width * k));
  const ph = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, pw, ph);
  bmp.close();
  return { rgba: ctx.getImageData(0, 0, pw, ph).data, pw, ph, name: file.name };
}

export function EditorController({ file, onFileModified }: EditorControllerProps) {
  const sessionRef = useRef<EditorSession | null>(null);
  const [machine] = useState(() => new InteractionStateMachine());
  const [editorState, setEditorState] = useState<LayahEditorState>(machine.getState());
  const [viewerFile, setViewerFile] = useState<File>(file);
  const [rev, setRev] = useState(0); // bumps whenever the model is rebuilt
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undoable: boolean } | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t); }, [notice]);
  const [tool, setTool] = useState<Tool>("select");
  const [placement, setPlacement] = useState<Placement>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [newText, setNewText] = useState("");
  const [font, setFont] = useState<string>(FAMILIES[0]);
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [shapeColor, setShapeColor] = useState("#2563eb");
  const [shapeWidth, setShapeWidth] = useState(2);
  const [shapeFill, setShapeFill] = useState(false);
  const [shapeMenu, setShapeMenu] = useState(false);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shapeMenu) return;
    const close = (e: MouseEvent) => { if (!shapeMenuRef.current?.contains(e.target as Node)) setShapeMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [shapeMenu]);
  const [nBold, setNBold] = useState(false);
  const [nItalic, setNItalic] = useState(false);
  const [size, setSize] = useState(14);
  const [color, setColor] = useState("#000000");
  const [editing, setEditing] = useState<{ value: string; warning: string | null; needsSubstitute?: string } | null>(null);
  const emitted = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const newTextInput = useRef<HTMLInputElement>(null);
  // The page overlay keeps focus after a pointer press, so move it to the field once the click has finished.
  useEffect(() => { if (placement) setTimeout(() => newTextInput.current?.focus(), 0); }, [placement]);

  const session = sessionRef.current;
  const activePage = editorState.activePage;

  // ---- load ----------------------------------------------------------------------------
  useEffect(() => {
    if (file === emitted.current) return; // our own export coming back from the parent
    let alive = true;
    const s = new EditorSession();
    setStatus("loading");
    setError(null);
    (async () => {
      try {
        const wasm = await (await fetch("/pdfium.wasm")).arrayBuffer();
        await s.open(new Uint8Array(await file.arrayBuffer()), wasm, { transfer: true }); // fresh array: no defensive copy needed
        if (!alive) { s.dispose(); return; }
        sessionRef.current?.dispose();
        sessionRef.current = s;
        machine.reset();
        setEditorState(machine.getState());
        setViewerFile(file);
        setRev(r => r + 1);
        setStatus("ready");
      } catch (e) {
        if (!alive) return;
        s.dispose();
        setError(errMsg(e));
        setStatus("failed");
      }
    })();
    return () => { alive = false; };
  }, [file, machine]);

  useEffect(() => () => { sessionRef.current?.dispose(); sessionRef.current = null; }, []);

  const sync = useCallback(() => setEditorState(machine.getState()), [machine]);

  /** Run a session mutation with busy/error handling, then refresh viewer + selection. */
  const run = useCallback(async (label: string, op: (s: EditorSession) => Promise<string[] | void>, pageIndex: number | null, done?: string, undoable = true) => {
    const s = sessionRef.current;
    if (!s) return;
    setBusy(label);
    setError(null);
    try {
      const sel = await op(s);
      machine.select(sel ?? [], pageIndex);
      const f = new File([s.bytes as BlobPart], file.name, { type: "application/pdf" });
      emitted.current = f;
      setViewerFile(f);
      onFileModified(f);
      setRev(r => r + 1);
      if (done) setNotice({ text: done, undoable });
    } catch (e) {
      setError(errMsg(e));
      setRev(r => r + 1); // session rolled back & rebuilt itself; refresh derived UI
    } finally {
      setBusy(null);
      sync();
    }
  }, [file.name, machine, onFileModified, sync]);

  const undo = useCallback(() => run("Undoing…", async s => { await s.undo(); }, null, "Undone", false), [run]);
  const redo = useCallback(() => run("Redoing…", async s => { await s.redo(); }, null, "Redone", false), [run]);

  const deleteSelection = useCallback(() => {
    const ids = machine.getState().selectedObjectIds;
    const p = machine.getState().activePage;
    if (!ids.length || p === null) return;
    run("Deleting…", async s => { await s.remove(p, ids); }, p, ids.length > 1 ? `Deleted ${ids.length} items` : "Deleted");
  }, [machine, run]);

  // ---- keyboard --------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (status !== "ready" || busy) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;

      // Undo / Redo
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }

      // Select all on current page
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const st = machine.getState();
        if (st.activePage !== null && sessionRef.current) {
          const page = pageOf(sessionRef.current, st.activePage);
          if (page) {
            selectAllOnPage(machine, page);
            sync();
          }
        }
        return;
      }

      // Arrow key nudging (move selected objects)
      const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (ARROW_KEYS.includes(e.key)) {
        const st = machine.getState();
        if (st.selectedObjectIds.length > 0 && st.activePage !== null && st.phase === "idle") {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1; // PDF points
          let dx = 0, dy = 0;
          if (e.key === "ArrowLeft")  dx = -step;
          if (e.key === "ArrowRight") dx =  step;
          if (e.key === "ArrowUp")    dy =  step; // PDF Y goes up
          if (e.key === "ArrowDown")  dy = -step;
          const p = st.activePage;
          const ids = [...st.selectedObjectIds];
          run("Moving…", s => s.move(p, ids, dx, dy), p, "Moved");
        }
        return;
      }

      if (e.key === "Escape") {
        setTool("select"); setPlacement(null); setPendingImage(null); setEditing(null);
        machine.reset();
        sync();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return; }
      machine.keyDown(e.key);
      sync();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [machine, status, busy, undo, redo, deleteSelection, sync, run]);

  // ---- toolbar actions ---------------------------------------------------------------------
  const selected = editorState.selectedObjectIds;
  const selPage = pageOf(session, activePage);
  void rev;
  const singleRun = selected.length === 1 && selPage?.layout.runs[selected[0]] ? selected[0] : null;
  const singleObj = selected.length === 1 && selPage ? selPage.objects[selected[0]] : undefined;

  const startEdit = () => {
    if (!session || activePage === null || !singleRun) return;
    const text = session.lineText(activePage, singleRun);
    setEditing({ value: text, warning: session.textEditWarning(activePage, singleRun) });
  };

  const applyEdit = async (substituteFont = false) => {
    if (!session || activePage === null || !singleRun || !editing) return;
    const p = activePage, id = singleRun, value = editing.value;
    if (!value.trim()) { setError("Text can't be empty - use Delete to remove it."); return; }
    setBusy("Applying text…");
    setError(null);
    try {
      const r = await session.replaceText(p, id, value, { substituteFont });
      machine.select(r.ids, p);
      commitFile(session);
      setEditing(null);
      setNotice({ text: "Text updated", undoable: true });
    } catch (e) {
      if (e instanceof FontCoverageError) {
        setEditing({ ...editing, needsSubstitute: e.message });
      } else setError(errMsg(e));
      setRev(r => r + 1);
    } finally { setBusy(null); sync(); }
  };

  const commitFile = (s: EditorSession) => {
    const f = new File([s.bytes as BlobPart], file.name, { type: "application/pdf" });
    emitted.current = f;
    setViewerFile(f);
    onFileModified(f);
    setRev(r => r + 1);
  };

  const resizeSelection = (factor: number) => {
    if (!session || activePage === null || !singleObj) return;
    const b = singleObj.bounds;
    const to: LayahObjectBounds = { left: b.left, top: b.top, right: b.left + (b.right - b.left) * factor, bottom: b.top - (b.top - b.bottom) * factor };
    run("Resizing…", s => s.resize(activePage, singleObj.id, to), activePage, "Image resized");
  };

  // Current style of the selected line (best effort from its font name); null when it is not a single text line.
  const textInfo = (() => {
    if (!session || activePage === null || !singleRun || !selPage) return null;
    try {
      const objs = session.resolveSourceIds(activePage, [singleRun]).map(i => selPage.objects[i]).filter(o => o?.type === "text") as unknown as LayahTextObject[];
      if (!objs.length) return null;
      const f = objs[0].fontFamily ?? "";
      return {
        bold: /bold|black|heavy/i.test(f) || (objs[0].fontWeight ?? 400) >= 600,
        italic: /italic|oblique/i.test(f),
        fontSize: objs[0].fontSize ?? 12,
        family: /courier|mono/i.test(f) ? "Courier" : /helvetica|arial|sans/i.test(f) ? "Helvetica" : /times|serif|georgia|garamond/i.test(f) ? "Times" : "", // "" = unknown (e.g. an embedded subset font)
      };
    } catch { return null; }
  })();
  const textActions: TextActions | null = textInfo && singleRun && activePage !== null ? {
    ...textInfo,
    size: f => run("Resizing text…", s => s.scale(activePage, [singleRun], f), activePage, f > 1 ? "Text larger" : "Text smaller"),
    style: patch => {
      const t = { ...textInfo, ...patch };
      run("Changing font…", s => s.restyleText(activePage, singleRun, { font: fontName(t.family || "Helvetica", t.bold, t.italic) }), activePage, "Font changed");
    },
    color: hex => run("Changing colour…", s => s.restyleText(activePage, singleRun, { color: hexToRgb(hex) }), activePage, "Colour changed"),
  } : null;

  // Selected shape (drawn by this editor): style and duplicate act on it; resize handles live on the page overlay.
  const shapeObj = singleObj?.type === "shape" ? (singleObj as unknown as LayahShapeObject) : null;
  const shapeActions: ShapeActions | null = shapeObj && activePage !== null ? {
    kind: shapeObj.shape.kind,
    closed: shapeObj.shape.kind === "rect" || shapeObj.shape.kind === "ellipse",
    width: shapeObj.shape.strokeWidth,
    setWidth: w => run("Updating shape…", s => s.updateShape(activePage, shapeObj.id, { strokeWidth: w }), activePage, "Thickness changed"),
    setStroke: hex => run("Updating shape…", s => s.updateShape(activePage, shapeObj.id, { stroke: hexToRgb(hex) }), activePage, "Colour changed"),
    setFill: hex => run("Updating shape…", s => s.updateShape(activePage, shapeObj.id, { fill: hex ? hexToRgb(hex) : null }), activePage, hex ? "Fill changed" : "Fill removed"),
    duplicate: () => run("Duplicating…", s => s.duplicateShape(activePage, shapeObj.id), activePage, "Shape duplicated"),
  } : null;

  const onPickImage = async (f: File | undefined) => {
    if (!f) return;
    setBusy("Reading image…"); setError(null);
    try {
      setPendingImage(await decodeImage(f));
      setTool("image");
    } catch { setError("That file couldn't be read as an image. Use PNG, JPEG, WebP or GIF."); }
    finally { setBusy(null); if (fileInput.current) fileInput.current.value = ""; }
  };

  /** Called by a page overlay when the user clicks in a placement tool. */
  const place = (pageIndex: number, x: number, y: number) => {
    if (tool === "text") {
      setPlacement({ pageIndex, x, y });
    } else if (tool === "image" && pendingImage) {
      const pg = session!.getPage(pageIndex);
      const w = Math.min(pg.width * 0.4, pendingImage.pw), h = w * (pendingImage.ph / pendingImage.pw);
      const left = Math.max(0, Math.min(x, pg.width - w)), top = Math.min(pg.height, Math.max(h, y));
      run("Inserting image…", s => s.addImage(pageIndex, { rgba: pendingImage.rgba, pixelWidth: pendingImage.pw, pixelHeight: pendingImage.ph, x: left, y: top - h, width: w, height: h }), pageIndex, "Image added")
        .then(() => { setPendingImage(null); setTool("select"); });
    }
  };

  /** Draw a shape from drag start `a` to end `b` (PDF points). A plain click makes a standard-size shape. */
  const drawShape = (pageIndex: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
    let { x: x2, y: y2 } = b;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) {
      if (shapeKind === "rect" || shapeKind === "ellipse") { x2 = a.x + 120; y2 = a.y - 70; } else { x2 = a.x + 110; y2 = a.y; }
    }
    const closed = shapeKind === "rect" || shapeKind === "ellipse";
    const rgb = hexToRgb(shapeColor);
    const label = SHAPES.find(sh => sh.id === shapeKind)!.label;
    run("Adding " + label.toLowerCase() + "…", async s => {
      return s.addShape(pageIndex, { kind: shapeKind, x1: a.x, y1: a.y, x2, y2, stroke: rgb, strokeWidth: shapeWidth, fill: closed && shapeFill ? rgb : undefined });
    }, pageIndex, label + " added").then(() => setTool("select"));
  };

  const whiteout = (pageIndex: number, r: { x: number; y: number; width: number; height: number }) =>
    run("Adding whiteout…", async s => { await s.addRect(pageIndex, { ...r, fill: [255, 255, 255] }); }, pageIndex, "Whiteout added");

  const confirmNewText = () => {
    if (!placement || !newText.trim()) return;
    const { pageIndex, x, y } = placement;
    run("Adding text…", s => s.addText(pageIndex, { text: newText, x, y: y - size, fontSize: size, fontFamily: fontName(font, nBold, nItalic), color: hexToRgb(color) }), pageIndex, "Text added")
      .then(() => { setPlacement(null); setNewText(""); setTool("select"); });
  };

  // ---- render --------------------------------------------------------------------------------
  if (status === "loading") return <div className="p-8 text-center text-slate-500 animate-pulse">Loading editor…</div>;
  if (status === "failed" || !session) {
    return (
      <div className="p-8 max-w-md mx-auto text-center">
        <p className="font-medium text-slate-900 mb-1">This PDF can&apos;t be opened in the editor</p>
        <p className="text-sm text-slate-600">{error ?? "Unknown error."}</p>
      </div>
    );
  }

  const btn = "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const input = "border border-slate-200 rounded-md px-2 py-1.5 text-sm bg-white";
  const seg = (active: boolean) => `flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-r border-slate-200 last:border-r-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`;
  const textRunOnly = !!singleRun;
  const modes: [Tool, string, string][] = [
    ["select", "Select", "Select, move and edit what is already on the page"],
    ["text", "Text", "Add new text"],
    ["image", "Image", "Add an image from your computer"],
    ["whiteout", "Whiteout", "Cover part of the page with white"],
  ];
  const pickMode = (t: Tool) => {
    setPlacement(null); setEditing(null);
    // Only the chosen tool is live: leaving Select drops the current selection so nothing else stays active.
    if (t !== "select") { machine.reset(); sync(); }
    if (t === "image") { fileInput.current?.click(); return; }
    setPendingImage(null); setShapeMenu(false); setTool(t);
  };
  const hint = tool === "image" && pendingImage ? `Click on the page to place "${pendingImage.name}".` : HINTS[tool];
  const cancelImage = tool === "image" && pendingImage;

  // Inline editing: the text box sits on the page at the real (zoom-scaled) size, like the final result.
  const editUi = editing ? (zoom: number) => (
    <div className="w-full">
      <input autoFocus onFocus={e => e.target.select()} value={editing.value} aria-label="New text"
        style={{ fontSize: (textInfo?.fontSize ?? 12) * zoom, lineHeight: 1.15, fontFamily: cssFamily(textInfo?.family ?? ""), fontWeight: textInfo?.bold ? 700 : 400, fontStyle: textInfo?.italic ? "italic" : "normal" }}
        className="w-full bg-white border border-dashed border-blue-500 outline-none px-0.5 shadow select-text"
        onChange={e => setEditing({ ...editing, value: e.target.value, needsSubstitute: undefined })}
        onKeyDown={e => { if (e.key === "Enter") applyEdit(); else if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
      <div className="mt-1 flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 rounded-md shadow-lg p-1.5">
        <button className={`${btn} bg-blue-600 text-white border-blue-600 hover:bg-blue-700`} disabled={!!busy} onClick={() => applyEdit()}>Done</button>
        {editing.needsSubstitute && <button className={`${btn} bg-white border-amber-400 text-amber-900`} disabled={!!busy} onClick={() => applyEdit(true)}>Use Helvetica instead</button>}
        <button className={`${btn} bg-white border-slate-200`} onClick={() => setEditing(null)}>Cancel</button>
        <span className="text-xs text-slate-500 px-1">Type your change · Enter = done · Esc = cancel</span>
      </div>
      {(editing.needsSubstitute || editing.warning) && (
        <p className="mt-1 max-w-sm rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs p-2 shadow">
          {editing.needsSubstitute ? `${editing.needsSubstitute} Nothing was changed. You can replace the line with Helvetica at the same position and size, but the look will differ from the original font.` : editing.warning}
        </p>
      )}
    </div>
  ) : null;

  // New text: type straight onto the page; the bar above holds font, size, bold/italic and colour.
  const placeUi = tool === "text" && placement ? (zoom: number) => ({
    input: (
      <input ref={newTextInput} value={newText} placeholder="Type your text" aria-label="New text"
        style={{ fontSize: size * zoom, lineHeight: 1.15, fontFamily: cssFamily(font), fontWeight: nBold ? 700 : 400, fontStyle: nItalic ? "italic" : "normal", color, width: `${Math.max(10, newText.length + 3)}ch` }}
        className="bg-white/90 border border-dashed border-blue-500 outline-none px-0.5 min-w-[8rem] max-w-[80vw] shadow"
        onChange={e => setNewText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") confirmNewText(); else if (e.key === "Escape") { e.stopPropagation(); setPlacement(null); } }} />
    ),
    bar: (
      <div className="flex items-stretch bg-white border border-blue-400 rounded-md shadow-lg overflow-hidden whitespace-nowrap"
        onMouseDown={e => { if (!(e.target as HTMLElement).closest("select,input")) e.preventDefault(); /* buttons must not steal focus from the text box */ }}>
        <select value={font} onChange={e => setFont(e.target.value)} aria-label="Font" className="h-8 text-xs text-blue-600 bg-white border-r border-blue-100 px-1.5 focus:outline-none">{FAMILIES.map(f => <option key={f}>{f}</option>)}</select>
        <TB onClick={() => setSize(s => Math.max(4, s - 1))} title="Smaller text" aria-label="Smaller text"><span className="text-[11px] font-semibold">A</span><span className="text-[9px]">&minus;</span></TB>
        <input type="number" min={4} max={200} value={size} aria-label="Font size" onChange={e => setSize(Math.max(4, Math.min(200, Number(e.target.value) || 12)))} className="h-8 w-12 text-sm text-center border-r border-blue-100 focus:outline-none" />
        <TB onClick={() => setSize(s => Math.min(200, s + 1))} title="Larger text" aria-label="Larger text"><span className="text-base font-semibold leading-none">A</span><span className="text-[9px]">+</span></TB>
        <TB active={nBold} onClick={() => setNBold(b => !b)} title="Bold" aria-pressed={nBold} className="font-bold">B</TB>
        <TB active={nItalic} onClick={() => setNItalic(i => !i)} title="Italic" aria-pressed={nItalic} className="italic">I</TB>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="Text colour" title="Text colour" className="h-8 w-9 p-1 border-r border-blue-100 bg-white cursor-pointer" />
        <button type="button" className="px-3 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40" disabled={!newText.trim() || !!busy} onClick={confirmNewText} title="Add text (Enter)">Add</button>
        <TB onClick={() => setPlacement(null)} title="Cancel (Esc)" aria-label="Cancel" className="text-slate-500">&#10005;</TB>
      </div>
    ),
  }) : null;

  // Tools live in the viewer's page/zoom row, so the editor needs only one toolbar row.
  const toolbarStart = (
    <>
      <div className="inline-flex shrink-0 border border-slate-200 rounded-md overflow-hidden" role="toolbar" aria-label="Edit tools" title={HINTS.select}>
        {modes.map(([t, label, tip]) => (
          <button key={t} className={seg(tool === t)} disabled={!!busy} title={tip} aria-pressed={tool === t} onClick={() => pickMode(t)}>
            <Icon name={t} /><span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
      <div ref={shapeMenuRef} className="relative shrink-0">
        <div className="inline-flex border border-slate-200 rounded-md overflow-hidden">
          <button className={seg(tool === "shape")} disabled={!!busy} title={"Draw a shape (" + SHAPES.find(sh => sh.id === shapeKind)!.label.toLowerCase() + ")"} aria-pressed={tool === "shape"} onClick={() => pickMode("shape")}>
            <Icon name={shapeKind} /><span className="hidden sm:inline">Shapes</span>
          </button>
          <button className={seg(tool === "shape") + " !px-1.5"} disabled={!!busy} aria-label="Choose a shape" aria-haspopup="menu" aria-expanded={shapeMenu} title="Choose a shape" onClick={() => setShapeMenu(o => !o)}>
            <Icon name="chevron" />
          </button>
        </div>
        {shapeMenu && (
          <div role="menu" className="absolute left-0 top-full mt-1 z-[70] w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {SHAPES.map(sh => (
              <button key={sh.id} role="menuitem" onClick={() => { setShapeKind(sh.id); setPlacement(null); setEditing(null); setPendingImage(null); setShapeMenu(false); setTool("shape"); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${shapeKind === sh.id && tool === "shape" ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-700 hover:bg-slate-50"}`}>
                <Icon name={sh.id} />{sh.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {tool === "shape" && (
        <div className="inline-flex shrink-0 items-center gap-2 text-xs text-slate-600">
          <input type="color" value={shapeColor} onChange={e => setShapeColor(e.target.value)} aria-label="Shape colour" title="Shape colour" className="h-8 w-9 p-1 border border-slate-200 rounded bg-white cursor-pointer" />
          <select value={shapeWidth} onChange={e => setShapeWidth(Number(e.target.value))} aria-label="Line thickness" title="Line thickness" className="h-8 border border-slate-200 rounded bg-white text-xs px-1">
            <option value={1}>Thin</option><option value={2}>Medium</option><option value={4}>Thick</option><option value={8}>Extra thick</option>
          </select>
          {(shapeKind === "rect" || shapeKind === "ellipse") && (
            <label className="flex items-center gap-1 cursor-pointer select-none"><input type="checkbox" checked={shapeFill} onChange={e => setShapeFill(e.target.checked)} />Filled</label>
          )}
        </div>
      )}
      <div className="inline-flex shrink-0 border border-slate-200 rounded-md overflow-hidden">
        <button className={seg(false)} disabled={!!busy || !session.canUndo} onClick={undo} title="Undo (Ctrl+Z)"><Icon name="undo" /><span className="hidden sm:inline">Undo</span></button>
        <button className={seg(false)} disabled={!!busy || !session.canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /><span className="hidden sm:inline">Redo</span></button>
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => onPickImage(e.target.files?.[0])} />
      {busy ? <span className="text-sm text-slate-500 animate-pulse" role="status">{busy}</span> : (tool !== "select" || cancelImage) && (
        <span className="text-xs text-slate-500 min-w-0 truncate" title={hint}>
          {hint}
          {cancelImage && <button className="underline ml-2" onClick={() => { setPendingImage(null); setTool("select"); }}>Cancel</button>}
        </span>
      )}
    </>
  );

  return (
    <div className="flex flex-col h-full min-h-0 select-none">
      <div className="flex-1 min-h-0 relative">
        {error && (
          <div role="alert" className="absolute top-0 inset-x-0 z-[60] bg-red-50 border-b border-red-200 text-red-800 px-4 py-2 text-sm flex items-start justify-between gap-4 shadow">
            <span>{error}</span><button className="underline" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <PdfViewer
          file={viewerFile}
          viewMode="scroll"
          preserveScroll
          toolbarStart={toolbarStart}
          renderPageOverlay={pageIndex => (
            <EditorPageOverlay
              key={pageIndex}
              pageIndex={pageIndex}
              session={session}
              rev={rev}
              machine={machine}
              editorState={editorState}
              sync={sync}
              tool={tool}
              placing={tool === "text" ? placement : null}
              disabled={!!busy}
              onPlace={place}
              onWhiteout={whiteout}
              onShape={drawShape}
              onReshape={(p, id, c) => run("Resizing…", s => s.updateShape(p, id, c), p, "Shape resized")}
              shapeStyle={{ kind: shapeKind, color: shapeColor, width: shapeWidth, fill: shapeFill }}
              onMove={(p, ids, dx, dy) => run("Moving…", s => s.move(p, ids, dx, dy), p, "Moved")}
              actions={{ shape: shapeActions, clear: () => { machine.reset(); sync(); }, canEdit: textRunOnly, isImage: singleObj?.type === "image", edit: startEdit, del: deleteSelection, resize: resizeSelection, text: textActions }}
              editUi={editUi}
              placeUi={placeUi}
            />
          )}
        />
        <div className={`absolute bottom-5 left-0 right-0 flex-col items-center gap-2 pointer-events-none z-[60] ${placement || editing ? "hidden" : "flex"}`}>
          {notice && (
            <div role="status" className="pointer-events-auto bg-slate-900 text-white text-sm rounded-full px-4 py-1.5 shadow-lg flex items-center gap-3">
              {notice.text}
              {notice.undoable && session.canUndo && <button className="underline text-blue-200 hover:text-white" onClick={undo}>Undo</button>}
            </div>
          )}
          <div className="pointer-events-auto bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2 shadow-lg flex items-center gap-3">
            <button className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-sm rounded-md px-4 py-2" disabled={!!busy}
              onClick={() => { downloadBytes(session.bytes, file.name.replace(/\.pdf$/i, "") + "-edited.pdf"); setNotice({ text: "Downloaded. Your original file is unchanged.", undoable: false }); }}>
              Download edited PDF
            </button>
            <span className="text-xs text-amber-900 hidden sm:inline">Edits apply as you go · Ctrl+Z to undo</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function EditorPageOverlay({ pageIndex, session, rev, machine, editorState, sync, tool, placing, disabled, onPlace, onWhiteout, onShape, onReshape, shapeStyle, onMove, actions, editUi, placeUi }: {
  pageIndex: number; session: EditorSession; rev: number; machine: InteractionStateMachine; editorState: LayahEditorState;
  sync: () => void; tool: Tool; placing: Placement; disabled: boolean;
  onPlace: (pageIndex: number, x: number, y: number) => void;
  onWhiteout: (pageIndex: number, r: { x: number; y: number; width: number; height: number }) => void;
  onShape: (pageIndex: number, a: { x: number; y: number }, b: { x: number; y: number }) => void;
  onReshape: (pageIndex: number, id: string, geometry: { x1: number; y1: number; x2: number; y2: number }) => void;
  shapeStyle: { kind: ShapeKind; color: string; width: number; fill: boolean };
  onMove: (pageIndex: number, ids: string[], dx: number, dy: number) => void;
  actions: SelectionActions;
  editUi: ((zoom: number) => React.ReactNode) | null;
  placeUi: ((zoom: number) => { input: React.ReactNode; bar: React.ReactNode }) | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const [wo, setWo] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [hd, setHd] = useState<{ id: string; handle: string; cur: { x1: number; y1: number; x2: number; y2: number } } | null>(null);
  const [hover, setHover] = useState<{ id: string; bounds: { left: number; right: number; top: number; bottom: number } } | null>(null);
  void rev;
  const page = pageOf(session, pageIndex);
  if (!page) return null;
  const reason = session.uneditableReason(pageIndex);
  if (reason) {
    return <div className="absolute top-2 left-2 z-50 rounded bg-amber-100 text-amber-900 text-xs px-2 py-1 pointer-events-none">{reason}</div>;
  }

  const ctx: PageCoordinateContext = { width: page.width, height: page.height, zoom: size.width ? size.width / page.width : 1, rotation: 0 };
  const toPdf = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return viewportToPdfPoint({ x: e.clientX - r.left, y: e.clientY - r.top }, ctx);
  };
  const mine = editorState.activePage === pageIndex;

  // All gesture decisions live in lib/document/gestures.ts; this component only translates DOM events.
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    const pt = toPdf(e);
    if (tool === "whiteout" || tool === "shape") {
      setWo({ a: pt, b: pt });
      try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic/expired pointer */ }
      return;
    }
    if (tool !== "select") { onPlace(pageIndex, pt.x, pt.y); return; }
    gestureDown(machine, page, pt, e.shiftKey);
    sync();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic/expired pointer: dragging still works without capture */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (wo) { setWo({ ...wo, b: toPdf(e) }); return; }
    // Hover highlight: shows what a click would select (select tool, nothing being dragged).
    if (tool === "select" && !disabled && editorState.phase === "idle" && e.pointerType === "mouse") {
      const h = hoverTarget(page, toPdf(e));
      if ((h?.id ?? null) !== (hover?.id ?? null)) setHover(h);
    } else if (hover) setHover(null);
    if (gestureMove(machine, pageIndex, toPdf(e), ctx.zoom)) sync();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (wo) {
      if (tool === "shape") { const { a, b } = wo; setWo(null); onShape(pageIndex, a, b); return; }
      const x = Math.min(wo.a.x, wo.b.x), y = Math.min(wo.a.y, wo.b.y);
      const width = Math.abs(wo.a.x - wo.b.x), height = Math.abs(wo.a.y - wo.b.y);
      setWo(null);
      if (width >= 4 && height >= 4) onWhiteout(pageIndex, { x, y, width, height });
      return;
    }
    const intent = gestureUp(machine, page, e.shiftKey, ctx.zoom);
    sync();
    if (intent?.type === "move") onMove(pageIndex, intent.objectIds, intent.deltaX, intent.deltaY);
  };
  // pointercancel and lostpointercapture abandon the gesture: they must never commit a move.
  const onPointerAbort = () => {
    if (tool !== "select") { setWo(null); return; }
    gestureCancel(machine, pageIndex);
    sync();
  };

  const dragPt = mine && editorState.phase === "dragging" && editorState.dragStartPoint && editorState.currentPointer
    ? { x: editorState.currentPointer.x - editorState.dragStartPoint.x, y: editorState.currentPointer.y - editorState.dragStartPoint.y }
    : null;

  const drag = dragPt
    ? { x: dragPt.x * ctx.zoom, y: -dragPt.y * ctx.zoom }
    : { x: 0, y: 0 };

  const selectedBounds = mine && tool === "select"
    ? editorState.selectedObjectIds.flatMap(id => {
        const o = page.layout.runs[id] ?? page.layout.textBlocks[id] ?? page.objects[id];
        if (!o) return [];
        const b = pdfToViewportBounds(o.bounds, ctx);
        let previewText: string | undefined;
        let objectType: "text" | "image" | "rect" | "shape" | "other" = "other";
        if (page.layout.runs[id]) {
          const run = page.layout.runs[id];
          previewText = run.sourceObjectIds.map(sid => (page.objects[sid] as LayahTextObject)?.text || "").join(" ").trim();
          objectType = "text";
        } else if (page.layout.textBlocks[id]) {
          objectType = "text";
          const srcIds = session.resolveSourceIds(pageIndex, [id]);
          previewText = srcIds.map(sid => (page.objects[sid] as LayahTextObject)?.text || "").join(" ").trim();
        } else if (page.objects[id]) {
          const obj = page.objects[id];
          if (obj.type === "text") {
            objectType = "text";
            previewText = (obj as LayahTextObject).text;
          } else if (obj.type === "image") {
            objectType = "image";
          } else if (obj.type === "shape") {
            objectType = "shape";
          } else {
            objectType = "other";
          }
        }
        return [{ id, bounds: { left: b.left + drag.x, right: b.right + drag.x, top: b.top + drag.y, bottom: b.bottom + drag.y }, text: previewText, type: objectType }];
      })
    : [];
  const selShape = mine && editorState.selectedObjectIds.length === 1
    ? (() => { const o = page.objects[editorState.selectedObjectIds[0]]; return o && o.type === "shape" ? (o as unknown as LayahShapeObject) : null; })()
    : null;
  const group = selectedBounds.length > 1 ? {
    left: Math.min(...selectedBounds.map(b => b.bounds.left)), top: Math.min(...selectedBounds.map(b => b.bounds.top)),
    right: Math.max(...selectedBounds.map(b => b.bounds.right)), bottom: Math.max(...selectedBounds.map(b => b.bounds.bottom)),
  } : null;
  const box = mine && editorState.phase === "selecting" && editorState.dragStartPoint && editorState.currentPointer
    ? pdfToViewportBounds({
        left: Math.min(editorState.dragStartPoint.x, editorState.currentPointer.x), right: Math.max(editorState.dragStartPoint.x, editorState.currentPointer.x),
        bottom: Math.min(editorState.dragStartPoint.y, editorState.currentPointer.y), top: Math.max(editorState.dragStartPoint.y, editorState.currentPointer.y),
      }, ctx)
    : null;
  const marker = placing && placing.pageIndex === pageIndex ? pdfToViewportBounds({ left: placing.x, right: placing.x + 2, bottom: placing.y - 16, top: placing.y }, ctx) : null;

  return (
    <div
      ref={ref}
      data-testid={`editor-overlay-${pageIndex}`}
      className={`absolute inset-0 z-50 ${tool === "whiteout" || tool === "shape" || (tool === "select" && mine && editorState.selectedObjectIds.length > 0) ? "touch-none" : "touch-pan-y"} ${
        tool === "select"
          ? editorState.phase === "dragging"
            ? "cursor-grabbing"
            : hover ? (editorState.selectedObjectIds.includes(hover.id) ? "cursor-move" : "cursor-pointer") : "cursor-default"
          : "cursor-crosshair"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerAbort}
      onLostPointerCapture={onPointerAbort}
      onPointerLeave={() => { if (hover) setHover(null); }}
      onDoubleClick={() => { if (tool === "select" && !disabled && actions.canEdit && mine) actions.edit(); }}
    >
      <SelectionOverlay
        selectedObjectBounds={selectedBounds}
        groupSelectionBounds={group}
        phase={editorState.phase}
        selectionBox={box}
        hoverBounds={hover && !editorState.selectedObjectIds.includes(hover.id) ? pdfToViewportBounds(hover.bounds, ctx) : null}
        dragDeltaPt={dragPt}
      />
      {marker && <div className="absolute bg-blue-600 pointer-events-none" style={{ left: marker.left, top: marker.top, width: 2, height: marker.bottom - marker.top }} />}
      {wo && tool === "shape" && (() => {
        const pa = pdfToViewportBounds({ left: wo.a.x, right: wo.a.x, bottom: wo.a.y, top: wo.a.y }, ctx);
        const pb = pdfToViewportBounds({ left: wo.b.x, right: wo.b.x, bottom: wo.b.y, top: wo.b.y }, ctx);
        const x1 = pa.left, y1 = pa.top, x2 = pb.left, y2 = pb.top;
        const w = shapeStyle.width * ctx.zoom, closed = shapeStyle.kind === "rect" || shapeStyle.kind === "ellipse";
        const common = { stroke: shapeStyle.color, strokeWidth: w, fill: closed && shapeStyle.fill ? shapeStyle.color : "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
        const ang = Math.atan2(y2 - y1, x2 - x1), head = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.45, Math.max(10, w * 5));
        return (
          <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" aria-hidden>
            {shapeStyle.kind === "rect" && <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} {...common} />}
            {shapeStyle.kind === "ellipse" && <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} {...common} />}
            {(shapeStyle.kind === "line" || shapeStyle.kind === "arrow") && <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />}
            {shapeStyle.kind === "arrow" && <polyline points={`${x2 + head * Math.cos(ang + Math.PI - 0.5)},${y2 + head * Math.sin(ang + Math.PI - 0.5)} ${x2},${y2} ${x2 + head * Math.cos(ang + Math.PI + 0.5)},${y2 + head * Math.sin(ang + Math.PI + 0.5)}`} {...common} fill="none" />}
          </svg>
        );
      })()}
      {wo && tool === "whiteout" && (() => {
        const r = pdfToViewportBounds({ left: Math.min(wo.a.x, wo.b.x), right: Math.max(wo.a.x, wo.b.x), bottom: Math.min(wo.a.y, wo.b.y), top: Math.max(wo.a.y, wo.b.y) }, ctx);
        return <div className="absolute border border-blue-500 border-dashed bg-white/70 pointer-events-none" style={{ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top }} />;
      })()}

      {/* Resize handles for a selected shape: drag to reshape (rect/ellipse: 8 handles, line/arrow: the two ends). */}
      {selShape && !disabled && tool === "select" && editorState.phase === "idle" && (() => {
        const g = hd ? hd.cur : selShape.shape;
        const pt = (x: number, y: number) => { const v = pdfToViewportBounds({ left: x, right: x, bottom: y, top: y }, ctx); return { x: v.left, y: v.top }; };
        const closed = selShape.shape.kind === "rect" || selShape.shape.kind === "ellipse";
        const L = Math.min(g.x1, g.x2), R = Math.max(g.x1, g.x2), B = Math.min(g.y1, g.y2), T = Math.max(g.y1, g.y2);
        const points: [string, number, number, string][] = closed
          ? [["nw", L, T, "nwse-resize"], ["n", (L + R) / 2, T, "ns-resize"], ["ne", R, T, "nesw-resize"], ["e", R, (B + T) / 2, "ew-resize"],
             ["se", R, B, "nwse-resize"], ["s", (L + R) / 2, B, "ns-resize"], ["sw", L, B, "nesw-resize"], ["w", L, (B + T) / 2, "ew-resize"]]
          : [["p1", g.x1, g.y1, "crosshair"], ["p2", g.x2, g.y2, "crosshair"]];
        const a = pt(g.x1, g.y1), b = pt(g.x2, g.y2);
        const ghost = { stroke: "#3b82f6", strokeWidth: 1, strokeDasharray: "4 3", fill: "none" } as const;
        return <>
          {hd && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" aria-hidden>
              {selShape.shape.kind === "rect" && <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...ghost} />}
              {selShape.shape.kind === "ellipse" && <ellipse cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2} {...ghost} />}
              {(selShape.shape.kind === "line" || selShape.shape.kind === "arrow") && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...ghost} />}
            </svg>
          )}
          {points.map(([h, x, y, cursor]) => {
            const v = pt(x, y);
            return (
              <div key={h} role="slider" aria-label={`Resize handle ${h}`} data-handle={h}
                className="absolute z-[61] w-3 h-3 -ml-1.5 -mt-1.5 bg-white border-2 border-blue-500 pointer-events-auto touch-none"
                style={{ left: v.x, top: v.y, cursor }}
                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } setHd({ id: selShape.id, handle: h, cur: { x1: selShape.shape.x1, y1: selShape.shape.y1, x2: selShape.shape.x2, y2: selShape.shape.y2 } }); }}
                onPointerMove={e => { e.stopPropagation(); if (hd && hd.handle === h) setHd({ ...hd, cur: dragHandle(selShape.shape, h, toPdf(e)) }); }}
                onPointerUp={e => {
                  e.stopPropagation();
                  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
                  if (hd && hd.handle === h) {
                    const c = hd.cur;
                    setHd(null);
                    if (Math.hypot(c.x1 - selShape.shape.x1, c.y1 - selShape.shape.y1) + Math.hypot(c.x2 - selShape.shape.x2, c.y2 - selShape.shape.y2) > 0.5) onReshape(pageIndex, selShape.id, c);
                  }
                }}
                onPointerCancel={e => { e.stopPropagation(); setHd(null); }}
                onLostPointerCapture={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()} />
            );
          })}
        </>;
      })()}

      {/* Floating UI. Pointer events stop here so pressing a control never starts a select/drag gesture. */}
      {(() => {
        const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onPointerUp: (e: React.PointerEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };
        const anchor = group ?? selectedBounds[0]?.bounds ?? null;
        const clampLeft = (left: number, width: number) => Math.max(0, Math.min(left, size.width - width));
        return <>
          {anchor && !disabled && !hd && editorState.phase === "idle" && !(editUi && selectedBounds.length === 1) && (
            <SelectionBar actions={actions} count={selectedBounds.length}
              style={{ left: clampLeft(anchor.left, Math.min(size.width, 330)), maxWidth: Math.max(size.width, 220), ...(anchor.top < 60 ? { top: anchor.bottom + 6 } : { top: anchor.top - 6, transform: "translateY(-100%)" }) }} />
          )}
          {editUi && selectedBounds.length === 1 && (
            <div {...stop} className="absolute z-[60] pointer-events-auto" style={{ left: clampLeft(selectedBounds[0].bounds.left - 2, 280), top: Math.max(0, selectedBounds[0].bounds.top - 3), width: Math.max((selectedBounds[0].bounds.right - selectedBounds[0].bounds.left) * 1.2 + 32, 280) }}>
              {editUi(ctx.zoom)}
            </div>
          )}
          {placeUi && marker && (() => {
            const p = placeUi(ctx.zoom);
            const shift = Math.max(0, marker.left + 420 - size.width); // keep the bar inside the page when clicking near the right edge
            return (
              <div {...stop} className="absolute z-[60] pointer-events-auto" style={{ left: marker.left, top: marker.top }}>
                {p.input}
                <div className="absolute" style={{ left: -shift, ...(marker.top < 56 ? { top: "100%", marginTop: 6 } : { bottom: "100%", marginBottom: 6 }) }}>{p.bar}</div>
              </div>
            );
          })()}
        </>;
      })()}
    </div>
  );
}
