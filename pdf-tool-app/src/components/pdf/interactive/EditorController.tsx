import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PdfViewer } from "@/components/pdf/viewer/PdfViewer";
import { SelectionOverlay } from "./SelectionOverlay";
import { EditorSession, FontCoverageError } from "@/lib/pdf/editor/session";
import { InteractionStateMachine, LayahEditorState } from "@/lib/document/interaction";
import { gestureDown, gestureMove, gestureUp, gestureCancel, selectAllOnPage, hoverTarget } from "@/lib/document/gestures";
import { viewportToPdfPoint, pdfToViewportBounds, PageCoordinateContext } from "@/lib/document/coordinates";
import { downloadBytes } from "@/lib/pdf/download";
import type { LayahObjectBounds, LayahTextObject } from "@/lib/document/types";

interface EditorControllerProps {
  file: File;
  onFileModified: (file: File) => void;
}

type Tool = "select" | "hand" | "text" | "image" | "whiteout" | "rect";
type Placement = { pageIndex: number; x: number; y: number } | null;
interface PendingImage { rgba: Uint8ClampedArray; pw: number; ph: number; name: string }

const ICONS: Record<string, string> = {
  select: "M5 3l14 7-6 2-2 6z",
  hand: "M8 13V5.5a1.5 1.5 0 013 0V12m0-6.5v-1a1.5 1.5 0 013 0V12m0-6.5a1.5 1.5 0 013 0V12m0-4a1.5 1.5 0 013 0v6a7 7 0 01-7 7h-1a7 7 0 01-5.6-2.8L3.5 14a1.5 1.5 0 012.3-1.9L8 14.5",
  text: "M4 6V4h16v2M12 4v16m-3 0h6",
  image: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  whiteout: "M7 21h10M5.5 13.5l7-7a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8l-6 6H9l-3.5-3.5a2 2 0 010-1.5z",
  rect: "M4 6h16v12H4z",
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
  hand: "Drag to move around the page. Choose Select to edit again.",
  text: "Click on the page where the text should go.",
  image: "Click on the page to place your image.",
  whiteout: "Drag a box over what you want to cover. This only covers it visually; to remove sensitive text, use Redact PDF.",
  rect: "Click on the page to place an outline rectangle. It can be undone, but not selected afterwards.",
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
interface SelectionActions { clear: () => void; canEdit: boolean; isImage: boolean; edit: () => void; del: () => void; resize: (factor: number) => void; text: TextActions | null }

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

/** Floating bar above the selection: only controls that work for what is selected. */
function SelectionBar({ actions, count, style }: { actions: SelectionActions; count: number; style: React.CSSProperties }) {
  const [palette, setPalette] = useState(false);
  const t = actions.text;
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
          <TB onClick={() => setPalette(p => !p)} title="Text colour" aria-label="Text colour" aria-expanded={palette} active={palette}>
            <Icon name="palette" />
          </TB>
        </>}
        {actions.isImage && <>
          <TB onClick={() => actions.resize(0.9)} title="Make the image 10% smaller" className="text-xs">Smaller</TB>
          <TB onClick={() => actions.resize(1.1)} title="Make the image 10% larger" className="text-xs">Larger</TB>
        </>}
        <TB danger onClick={actions.del} title="Delete (Del)" aria-label="Delete"><Icon name="trash" /></TB>
      </div>
      {t && palette && (
        <div className="mt-1 inline-flex gap-1.5 bg-white border border-slate-200 rounded-md shadow-lg p-1.5">
          {SWATCHES.map(c => (
            <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => { t.color(c); setPalette(false); }}
              className="w-6 h-6 rounded-full border border-slate-300" style={{ background: c }} />
          ))}
        </div>
      )}
    </div>
  );
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
    } else if (tool === "rect") {
      run("Adding rectangle…", async s => { await s.addRect(pageIndex, { x, y: y - 50, width: 120, height: 50, stroke: hexToRgb(color), strokeWidth: 2 }); }, pageIndex, "Rectangle added")
        .then(() => setTool("select"));
    }
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
    ["hand", "Hand", "Drag to pan the page (or hold Space, or drag with the middle button)"],
    ["text", "Text", "Add new text"],
    ["image", "Image", "Add an image from your computer"],
    ["whiteout", "Whiteout", "Cover part of the page with white"],
    ["rect", "Rectangle", "Draw an outline rectangle"],
  ];
  const pickMode = (t: Tool) => {
    setPlacement(null); setEditing(null);
    if (t === "image") { fileInput.current?.click(); return; }
    setPendingImage(null); setTool(t);
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
          handTool={tool === "hand"}
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
              onMove={(p, ids, dx, dy) => run("Moving…", s => s.move(p, ids, dx, dy), p, "Moved")}
              actions={{ clear: () => { machine.reset(); sync(); }, canEdit: textRunOnly, isImage: singleObj?.type === "image", edit: startEdit, del: deleteSelection, resize: resizeSelection, text: textActions }}
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

function EditorPageOverlay({ pageIndex, session, rev, machine, editorState, sync, tool, placing, disabled, onPlace, onWhiteout, onMove, actions, editUi, placeUi }: {
  pageIndex: number; session: EditorSession; rev: number; machine: InteractionStateMachine; editorState: LayahEditorState;
  sync: () => void; tool: Tool; placing: Placement; disabled: boolean;
  onPlace: (pageIndex: number, x: number, y: number) => void;
  onWhiteout: (pageIndex: number, r: { x: number; y: number; width: number; height: number }) => void;
  onMove: (pageIndex: number, ids: string[], dx: number, dy: number) => void;
  actions: SelectionActions;
  editUi: ((zoom: number) => React.ReactNode) | null;
  placeUi: ((zoom: number) => { input: React.ReactNode; bar: React.ReactNode }) | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const [wo, setWo] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
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
    if (disabled || tool === "hand") return; // the viewer pans; nothing on the page is picked
    const pt = toPdf(e);
    if (tool === "whiteout") {
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

  const selectedBounds = mine
    ? editorState.selectedObjectIds.flatMap(id => {
        const o = page.layout.runs[id] ?? page.layout.textBlocks[id] ?? page.objects[id];
        if (!o) return [];
        const b = pdfToViewportBounds(o.bounds, ctx);
        let previewText: string | undefined;
        let objectType: "text" | "image" | "rect" | "other" = "other";
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
          } else {
            objectType = "other";
          }
        }
        return [{ id, bounds: { left: b.left + drag.x, right: b.right + drag.x, top: b.top + drag.y, bottom: b.bottom + drag.y }, text: previewText, type: objectType }];
      })
    : [];
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
      className={`absolute inset-0 z-50 ${tool === "whiteout" || (tool === "select" && mine && editorState.selectedObjectIds.length > 0) ? "touch-none" : "touch-pan-y"} ${
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
      {wo && (() => {
        const r = pdfToViewportBounds({ left: Math.min(wo.a.x, wo.b.x), right: Math.max(wo.a.x, wo.b.x), bottom: Math.min(wo.a.y, wo.b.y), top: Math.max(wo.a.y, wo.b.y) }, ctx);
        return <div className="absolute border border-blue-500 border-dashed bg-white/70 pointer-events-none" style={{ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top }} />;
      })()}

      {/* Floating UI. Pointer events stop here so pressing a control never starts a select/drag gesture. */}
      {(() => {
        const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onPointerUp: (e: React.PointerEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };
        const anchor = group ?? selectedBounds[0]?.bounds ?? null;
        const clampLeft = (left: number, width: number) => Math.max(0, Math.min(left, size.width - width));
        return <>
          {anchor && !disabled && editorState.phase === "idle" && !(editUi && selectedBounds.length === 1) && (
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
