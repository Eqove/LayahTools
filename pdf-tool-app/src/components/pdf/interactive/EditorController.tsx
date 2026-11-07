import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PdfViewer } from "@/components/pdf/viewer/PdfViewer";
import { SelectionOverlay } from "./SelectionOverlay";
import { EditorSession, FontCoverageError } from "@/lib/pdf/editor/session";
import { InteractionStateMachine, LayahEditorState } from "@/lib/document/interaction";
import { gestureDown, gestureMove, gestureUp, gestureCancel, selectAllOnPage } from "@/lib/document/gestures";
import { viewportToPdfPoint, pdfToViewportBounds, PageCoordinateContext } from "@/lib/document/coordinates";
import { downloadBytes } from "@/lib/pdf/download";
import type { LayahObjectBounds, LayahTextObject } from "@/lib/document/types";

interface EditorControllerProps {
  file: File;
  onFileModified: (file: File) => void;
}

type Tool = "select" | "text" | "image" | "rect";
type Placement = { pageIndex: number; x: number; y: number } | null;
interface PendingImage { rgba: Uint8ClampedArray; pw: number; ph: number; name: string }

const FONTS = ["Helvetica", "Times-Roman", "Courier"];
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
  const [tool, setTool] = useState<Tool>("select");
  const [placement, setPlacement] = useState<Placement>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [newText, setNewText] = useState("");
  const [font, setFont] = useState(FONTS[0]);
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
  const run = useCallback(async (label: string, op: (s: EditorSession) => Promise<string[] | void>, pageIndex: number | null) => {
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
    } catch (e) {
      setError(errMsg(e));
      setRev(r => r + 1); // session rolled back & rebuilt itself; refresh derived UI
    } finally {
      setBusy(null);
      sync();
    }
  }, [file.name, machine, onFileModified, sync]);

  const undo = useCallback(() => run("Undoing…", async s => { await s.undo(); }, null), [run]);
  const redo = useCallback(() => run("Redoing…", async s => { await s.redo(); }, null), [run]);

  const deleteSelection = useCallback(() => {
    const ids = machine.getState().selectedObjectIds;
    const p = machine.getState().activePage;
    if (!ids.length || p === null) return;
    run("Deleting…", async s => { await s.remove(p, ids); }, p);
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
          run("Moving…", s => s.move(p, ids, dx, dy), p);
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
    const src = session.resolveSourceIds(activePage, [singleRun]);
    const text = src.map(i => (selPage!.objects[i] as LayahTextObject).text).join(" ").trim();
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
    run("Resizing…", s => s.resize(activePage, singleObj.id, to), activePage);
  };

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
      run("Inserting image…", s => s.addImage(pageIndex, { rgba: pendingImage.rgba, pixelWidth: pendingImage.pw, pixelHeight: pendingImage.ph, x: left, y: top - h, width: w, height: h }), pageIndex)
        .then(() => { setPendingImage(null); setTool("select"); });
    } else if (tool === "rect") {
      run("Adding rectangle…", async s => { await s.addRect(pageIndex, { x, y: y - 50, width: 120, height: 50, stroke: hexToRgb(color), strokeWidth: 2 }); }, pageIndex)
        .then(() => setTool("select"));
    }
  };

  const confirmNewText = () => {
    if (!placement || !newText.trim()) return;
    const { pageIndex, x, y } = placement;
    run("Adding text…", s => s.addText(pageIndex, { text: newText, x, y: y - size, fontSize: size, fontFamily: font, color: hexToRgb(color) }), pageIndex)
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
  const toolBtn = (t: Tool, label: string, onClick?: () => void) => (
    <button key={t} onClick={onClick ?? (() => { setTool(t); setPlacement(null); })} disabled={!!busy}
      className={`${btn} ${tool === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}>{label}</button>
  );
  const input = "border border-slate-200 rounded-md px-2 py-1.5 text-sm bg-white";
  const textRunOnly = !!singleRun;
  const hint =
    tool === "text" ? (placement ? "" : "Click on the page where the text should go.") :
    tool === "image" ? (pendingImage ? `Click on the page to place “${pendingImage.name}”.` : "") :
    tool === "rect" ? "Click on the page to place an outline rectangle (it can be undone, but not selected afterwards)." : "";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex flex-wrap items-center gap-2 shrink-0">
        {toolBtn("select", "Select")}
        {toolBtn("text", "Add text")}
        {toolBtn("image", "Add image", () => fileInput.current?.click())}
        {toolBtn("rect", "Rectangle")}
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => onPickImage(e.target.files?.[0])} />
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={!!busy || !session.canUndo} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
        <button className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={!!busy || !session.canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">Redo</button>
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={!!busy || !textRunOnly} onClick={startEdit} title={textRunOnly ? "Edit the selected line of text" : "Select a single line of text to edit it"}>Edit text</button>
        <button className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={!!busy || !selected.length} onClick={deleteSelection} title="Delete selected (Del / Backspace). Arrow keys nudge, Shift+Arrow for 10pt. Ctrl+A selects all.">Delete</button>
        <button className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={!!busy || !singleObj || singleObj.type !== "image"} onClick={() => resizeSelection(0.9)} title="Make the selected image 10% smaller">Smaller</button>
        <button className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={!!busy || !singleObj || singleObj.type !== "image"} onClick={() => resizeSelection(1.1)} title="Make the selected image 10% larger">Larger</button>
        <div className="ml-auto flex items-center gap-3">
          {busy && <span className="text-sm text-slate-500 animate-pulse" role="status">{busy}</span>}
          <button className={`${btn} bg-blue-600 text-white border-blue-600 hover:bg-blue-700`} disabled={!!busy} onClick={() => downloadBytes(session.bytes, file.name.replace(/\.pdf$/i, "") + "-edited.pdf")}>Download PDF</button>
        </div>
      </div>

      {(tool === "text" || tool === "rect") && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex flex-wrap items-center gap-2 shrink-0 text-sm">
          {tool === "text" && <>
            <select className={input} value={font} onChange={e => setFont(e.target.value)} aria-label="Font">{FONTS.map(f => <option key={f}>{f}</option>)}</select>
            <input className={`${input} w-20`} type="number" min={4} max={200} value={size} onChange={e => setSize(Math.max(4, Math.min(200, Number(e.target.value) || 12)))} aria-label="Font size" />
          </>}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="Colour" className="h-8 w-10 border border-slate-200 rounded" />
          {tool === "text" && placement && <>
            <input ref={newTextInput} className={`${input} flex-1 min-w-[12rem]`} value={newText} placeholder="Type the text…" onChange={e => setNewText(e.target.value)} onKeyDown={e => e.key === "Enter" && confirmNewText()} />
            <button className={`${btn} bg-blue-600 text-white border-blue-600`} disabled={!newText.trim() || !!busy} onClick={confirmNewText}>Add</button>
            <button className={`${btn} bg-white border-slate-200`} onClick={() => setPlacement(null)}>Cancel</button>
          </>}
          {hint && <span className="text-slate-600">{hint}</span>}
        </div>
      )}
      {tool === "image" && pendingImage && <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 text-sm text-slate-600 shrink-0">{hint} <button className="underline ml-2" onClick={() => { setPendingImage(null); setTool("select"); }}>Cancel</button></div>}

      {editing && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 shrink-0 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <input autoFocus className={`${input} flex-1 min-w-[12rem]`} value={editing.value} onChange={e => setEditing({ ...editing, value: e.target.value, needsSubstitute: undefined })} onKeyDown={e => e.key === "Enter" && applyEdit()} aria-label="New text" />
            <button className={`${btn} bg-blue-600 text-white border-blue-600`} disabled={!!busy} onClick={() => applyEdit()}>Apply</button>
            {editing.needsSubstitute && <button className={`${btn} bg-white border-amber-400 text-amber-900`} disabled={!!busy} onClick={() => applyEdit(true)}>Use Helvetica instead</button>}
            <button className={`${btn} bg-white border-slate-200`} onClick={() => setEditing(null)}>Cancel</button>
          </div>
          <p className="mt-1 text-amber-900">{editing.needsSubstitute ? `${editing.needsSubstitute} Nothing was changed. You can replace the line with Helvetica at the same position and size, but the look will differ from the original font.` : editing.warning}</p>
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 border-b border-red-200 text-red-800 px-4 py-2 text-sm flex items-start justify-between gap-4 shrink-0">
          <span>{error}</span><button className="underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <PdfViewer
          file={viewerFile}
          viewMode="scroll"
          preserveScroll
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
              onMove={(p, ids, dx, dy) => run("Moving…", s => s.move(p, ids, dx, dy), p)}
            />
          )}
        />
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

function EditorPageOverlay({ pageIndex, session, rev, machine, editorState, sync, tool, placing, disabled, onPlace, onMove }: {
  pageIndex: number; session: EditorSession; rev: number; machine: InteractionStateMachine; editorState: LayahEditorState;
  sync: () => void; tool: Tool; placing: Placement; disabled: boolean;
  onPlace: (pageIndex: number, x: number, y: number) => void;
  onMove: (pageIndex: number, ids: string[], dx: number, dy: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
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
    if (tool !== "select") { onPlace(pageIndex, pt.x, pt.y); return; }
    gestureDown(machine, page, pt, e.shiftKey);
    sync();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic/expired pointer: dragging still works without capture */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (gestureMove(machine, pageIndex, toPdf(e), ctx.zoom)) sync();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const intent = gestureUp(machine, page, e.shiftKey, ctx.zoom);
    sync();
    if (intent?.type === "move") onMove(pageIndex, intent.objectIds, intent.deltaX, intent.deltaY);
  };
  // pointercancel and lostpointercapture abandon the gesture: they must never commit a move.
  const onPointerAbort = () => {
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
      className={`absolute inset-0 z-50 touch-none ${
        tool === "select"
          ? editorState.phase === "dragging"
            ? "cursor-grabbing"
            : "cursor-default"
          : "cursor-crosshair"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerAbort}
      onLostPointerCapture={onPointerAbort}
    >
      <SelectionOverlay
        selectedObjectBounds={selectedBounds}
        groupSelectionBounds={group}
        phase={editorState.phase}
        selectionBox={box}
        dragDeltaPt={dragPt}
      />
      {marker && <div className="absolute bg-blue-600 pointer-events-none" style={{ left: marker.left, top: marker.top, width: 2, height: marker.bottom - marker.top }} />}
    </div>
  );
}
