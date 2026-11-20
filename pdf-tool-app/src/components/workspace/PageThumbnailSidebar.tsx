"use client";

import React, { useState, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { rotateSinglePage, deleteSinglePage, extractSinglePage } from "@/lib/pdf/page-actions";

// Same worker as PdfViewer: the thumbnails can mount before the viewer has loaded.
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PageThumbnailSidebarProps {
  file: File;
  activePageIndex?: number;
  onPageSelect?: (pageIndex: number) => void;
  onFileModified?: (file: File) => void;
  onExtractOutput?: (extractedFile: File) => void;
  /** "panel": desktop side column. "floating": phone layout, a page pill and an overlay over the viewer. */
  variant?: "panel" | "floating";
}

/** The viewer's live page element (skips the hidden double-buffer copy). */
function livePage(n: number): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-page-number="${n}"]`)).find((el) => !el.closest("[aria-hidden],[data-thumbs]")) ?? null;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

const SIZES = { S: 96, M: 132, L: 176 } as const;
type Size = keyof typeof SIZES;
const SIZE_KEY = "layah.thumbSize";

const ICONS = {
  rotateLeft: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11",
  rotateRight: "M15 14l5-5-5-5m5 5H9.5a5.5 5.5 0 000 11H13",
  extract: "M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14",
  delete: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  collapse: "M11 19l-7-7 7-7m8 14l-7-7 7-7",
  expand: "M13 5l7 7-7 7M5 5l7 7-7 7",
  undo: "M3 10h10a5 5 0 010 10H9M3 10l5-5M3 10l5 5",
};

function Icon({ d, className = "w-4 h-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}

export function PageThumbnailSidebar({
  file,
  activePageIndex,
  onPageSelect,
  onFileModified,
  onExtractOutput,
  variant = "panel",
}: PageThumbnailSidebarProps) {
  const floating = variant === "floating";
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [pillTop, setPillTop] = useState(12);
  const [panelBottom, setPanelBottom] = useState(12);
  const [pillShown, setPillShown] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [size, setSize] = useState<Size>("M");
  const [localPage, setLocalPage] = useState(0);
  const [goTo, setGoTo] = useState("");
  // One-step undo: the bytes before our last rotate/delete. Dropped when the file changes from elsewhere.
  const [undo, setUndo] = useState<{ file: File; label: string } | null>(null);
  const produced = useRef<File | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current = activePageIndex ?? localPage;
  const width = SIZES[size];

  useEffect(() => {
    try {
      const s = localStorage.getItem(SIZE_KEY);
      if (s === "S" || s === "M" || s === "L") setSize(s);
    } catch { /* storage blocked: keep the default */ }
  }, []);

  useEffect(() => {
    setNumPages(0);
    setActionError(null);
    if (file !== produced.current) setUndo(null);
  }, [file]);

  // Keep the current page's thumbnail in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-thumb="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, numPages, open]);

  // Follow the viewer: the page filling most of the view becomes current (when the parent doesn't say).
  // The floating variant also sits its pill just below the viewer's toolbar, whatever height that wraps to.
  useEffect(() => {
    if (!numPages) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let best = -1, bestH = 0;
      for (let n = 1; n <= numPages; n++) {
        const r = livePage(n)?.getBoundingClientRect();
        if (!r) continue;
        const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
        if (h > bestH) { bestH = h; best = n - 1; }
      }
      if (best >= 0 && activePageIndex === undefined) setLocalPage(best);
      if (floating && rootRef.current) {
        const sc = scrollParent(livePage(1));
        if (sc) {
          const s = sc.getBoundingClientRect(), r = rootRef.current.getBoundingClientRect();
          setPillTop(Math.max(8, s.top - r.top + 10));
          setPanelBottom(Math.max(8, r.bottom - s.bottom + 10));
        }
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    const t = setTimeout(update, 300); // pages render after load
    return () => { document.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); clearTimeout(t); };
  }, [numPages, activePageIndex, floating]);

  // Phone (like Apple's PDF reader): the page pill shows while the document scrolls and fades out shortly after.
  // A tap on the document (not a scroll) closes the thumbnail panel.
  useEffect(() => {
    if (!floating) return;
    let hide = 0;
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return; // scrolling the thumbnails doesn't count
      setPillShown(true);
      clearTimeout(hide);
      hide = window.setTimeout(() => setPillShown(false), 1500);
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = rootRef.current?.contains(e.target as Node) ? null : { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && !rootRef.current?.contains(e.target as Node)) setOpen(false);
      down = null;
    };
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      clearTimeout(hide);
    };
  }, [floating]);

  const pickSize = (s: Size) => {
    setSize(s);
    try { localStorage.setItem(SIZE_KEY, s); } catch { /* not persisted */ }
  };

  const select = (i: number) => {
    if (i < 0 || i >= numPages) return;
    setLocalPage(i);
    onPageSelect?.(i);
    livePage(i + 1)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setActionError(null);
    setNotice(null);
    try { await fn(); }
    catch (err: unknown) { setActionError(err instanceof Error ? err.message : `Failed: ${label}`); }
    finally { setBusy(null); }
  }

  const modify = (label: string, make: () => Promise<File>) => run(label, async () => {
    if (!onFileModified) return;
    const before = file;
    const updated = await make();
    produced.current = updated;
    setUndo({ file: before, label });
    onFileModified(updated);
  });

  const rotate = (i: number, deg: number) =>
    modify(`Rotated page ${i + 1}`, () => rotateSinglePage(file, i, deg));

  const remove = (i: number) => {
    if (numPages <= 1) { setActionError("Can't delete the only page."); return; }
    if (current >= numPages - 1 && current > 0) select(current - 1);
    return modify(`Deleted page ${i + 1}`, () => deleteSinglePage(file, i));
  };

  const extract = (i: number) => run(`Extract page ${i + 1}`, async () => {
    if (!onExtractOutput) return;
    onExtractOutput(await extractSinglePage(file, i));
    setNotice(`Page ${i + 1} saved to results`);
  });

  const doUndo = () => {
    if (!undo || !onFileModified) return;
    produced.current = undo.file;
    onFileModified(undo.file);
    setNotice(`Undid: ${undo.label.toLowerCase()}`);
    setUndo(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const k = e.key;
    const go = k === "ArrowDown" || k === "ArrowRight" ? current + 1 : k === "ArrowUp" || k === "ArrowLeft" ? current - 1
      : k === "Home" ? 0 : k === "End" ? numPages - 1 : null;
    if (go !== null) { e.preventDefault(); select(go); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z" && undo) { e.preventDefault(); doUndo(); return; }
    if (k === "r" || k === "R") { e.preventDefault(); rotate(current, e.shiftKey ? 270 : 90); return; }
    if (k === "Delete") { e.preventDefault(); remove(current); }
  };

  if (floating) {
    const canAct = !!onFileModified || !!onExtractOutput;
    const sheetBtn = "w-full h-12 px-4 flex items-center gap-3 text-[15px] text-slate-800 active:bg-slate-100 disabled:opacity-40";
    const status = actionError ?? (busy ? `${busy}…` : notice ?? undo?.label);
    return (
      <div ref={rootRef} className="absolute inset-0 pointer-events-none z-30 select-none">
        {/* Page pill: tap to show / hide the thumbnails */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide pages" : "Show pages"}
          style={{ top: pillTop }}
          tabIndex={pillShown || open ? 0 : -1}
          className={`absolute left-3 h-11 pl-3 pr-4 flex items-center gap-2 rounded-full bg-white/90 backdrop-blur-md border border-slate-200 shadow-lg text-[15px] font-medium text-slate-900 active:scale-95 transition-all duration-300 ${
            pillShown || open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-2 pointer-events-none"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="3" strokeWidth={1.8} />
            <path d="M9 4.5v15M5.5 8h1.5M5.5 11h1.5M5.5 14h1.5" strokeWidth={1.8} strokeLinecap="round" />
          </svg>
          {numPages ? `${current + 1} of ${numPages}` : "Pages"}
        </button>

        {/* Status / undo, next to the pill */}
        {status && (
          <div aria-live="polite" style={{ top: pillTop }} className={`pointer-events-auto absolute right-3 max-w-[55%] h-11 pl-3 pr-2 flex items-center gap-2 rounded-full shadow-lg text-sm backdrop-blur-md ${actionError ? "bg-red-600/90 text-white" : "bg-slate-900/85 text-white"}`}>
            <span className="truncate">{status}</span>
            {undo && !busy && !actionError && onFileModified && (
              <button type="button" onClick={doUndo} className="shrink-0 px-2 h-8 rounded-full bg-white/20 font-semibold">Undo</button>
            )}
            {(actionError || notice) && (
              <button type="button" aria-label="Dismiss" onClick={() => { setActionError(null); setNotice(null); }} className="shrink-0 w-8 h-8 rounded-full">✕</button>
            )}
          </div>
        )}

        {/* Thumbnail overlay */}
        <div
          ref={listRef}
          data-thumbs
          style={{ top: pillTop + 54, bottom: panelBottom }}
          className={`pointer-events-auto absolute left-3 w-[124px] overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-[28px] bg-slate-700/55 backdrop-blur-xl shadow-2xl border border-white/20 p-2.5 transition-all duration-200 origin-top-left ${open ? "opacity-100 scale-100" : "opacity-0 scale-95 !pointer-events-none"}`}
          aria-hidden={!open}
        >
          <Document
            file={file}
            onLoadSuccess={({ numPages: count }) => setNumPages(count)}
            loading={<div className="text-center py-6 text-xs text-white/80">Loading…</div>}
            error={<div className="text-center py-6 text-xs text-white/80">Thumbnails unavailable</div>}
            className="space-y-2.5"
          >
            {open && Array.from({ length: numPages }, (_, idx) => {
              const isCurrent = idx === current;
              return (
                <div key={`m-${idx}`} data-thumb={idx} className={`relative rounded-2xl p-1.5 transition-colors ${isCurrent ? "bg-white/35" : ""}`}>
                  <button type="button" onClick={() => select(idx)} aria-label={`Go to page ${idx + 1}`} aria-current={isCurrent ? "page" : undefined} className="block w-full">
                    <div className={`overflow-hidden rounded-md bg-white shadow ${isCurrent ? "ring-2 ring-white" : ""}`}>
                      <Page pageNumber={idx + 1} width={92} renderTextLayer={false} renderAnnotationLayer={false}
                        loading={<div className="bg-white/70" style={{ width: 92, height: 120 }} />} />
                    </div>
                    <span className="block mt-1 text-center text-xs font-semibold text-white drop-shadow">{idx + 1}</span>
                  </button>
                  {isCurrent && canAct && (
                    <button
                      type="button"
                      onClick={() => setMenuFor(idx)}
                      aria-label={`Actions for page ${idx + 1}`}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-10 h-10 rounded-full bg-slate-500/70 backdrop-blur text-white text-lg leading-none flex items-center justify-center shadow"
                    >
                      •••
                    </button>
                  )}
                </div>
              );
            })}
          </Document>
        </div>

        {/* Action sheet for one page */}
        {menuFor !== null && (
          <div className="pointer-events-auto fixed inset-0 z-50 flex items-end bg-black/30" onClick={() => setMenuFor(null)}>
            <div role="dialog" aria-label={`Page ${menuFor + 1} actions`} className="w-full p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="rounded-2xl bg-white overflow-hidden divide-y divide-slate-100">
                <div className="h-10 flex items-center justify-center text-xs font-semibold text-slate-500">Page {menuFor + 1} of {numPages}</div>
                {onFileModified && (
                  <>
                    <button type="button" className={sheetBtn} disabled={!!busy} onClick={() => { rotate(menuFor, 270); setMenuFor(null); }}><Icon d={ICONS.rotateLeft} className="w-5 h-5" />Rotate left</button>
                    <button type="button" className={sheetBtn} disabled={!!busy} onClick={() => { rotate(menuFor, 90); setMenuFor(null); }}><Icon d={ICONS.rotateRight} className="w-5 h-5" />Rotate right</button>
                  </>
                )}
                {onExtractOutput && (
                  <button type="button" className={sheetBtn} disabled={!!busy} onClick={() => { extract(menuFor); setMenuFor(null); }}><Icon d={ICONS.extract} className="w-5 h-5" />Save page as PDF</button>
                )}
                {onFileModified && (
                  <button type="button" className={`${sheetBtn} !text-red-600`} disabled={!!busy || numPages <= 1} onClick={() => { remove(menuFor); setMenuFor(null); }}>
                    <Icon d={ICONS.delete} className="w-5 h-5" />{numPages <= 1 ? "Can't delete the only page" : "Delete page"}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setMenuFor(null)} className="w-full h-12 rounded-2xl bg-white text-[15px] font-semibold text-slate-900">Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <div className="w-11 bg-white border-r border-slate-200 flex flex-col items-center py-3 shrink-0 select-none">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          title="Show pages"
          aria-label="Show pages"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
        >
          <Icon d={ICONS.expand} className="w-5 h-5" />
        </button>
        <span className="mt-4 [writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-wider text-slate-600">
          Pages {numPages ? `· ${current + 1}/${numPages}` : ""}
        </span>
      </div>
    );
  }

  const canEdit = !!onFileModified;
  const actionBtn = "h-8 w-8 flex items-center justify-center rounded-md text-slate-600 bg-white border border-slate-200 hover:border-slate-400 hover:text-slate-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <aside
      aria-label="Document pages"
      style={{ width: width + 48 }}
      className="bg-white border-r border-slate-200 flex flex-col shrink-0 select-none relative transition-[width] duration-200"
    >
      {/* Header: count, collapse */}
      <div className="h-11 px-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <span className="text-sm font-semibold text-slate-800">
          Pages{numPages > 0 && <span className="ml-1.5 text-slate-500 font-normal">{current + 1} / {numPages}</span>}
        </span>
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          title="Hide pages"
          aria-label="Hide pages"
          className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors"
        >
          <Icon d={ICONS.collapse} />
        </button>
      </div>

      {/* Toolbar: go to page, thumbnail size */}
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
        <form
          className="flex-1 min-w-0"
          onSubmit={(e) => { e.preventDefault(); const n = parseInt(goTo, 10); if (n >= 1 && n <= numPages) { select(n - 1); setGoTo(""); } }}
        >
          <input
            value={goTo}
            onChange={(e) => setGoTo(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Go to…"
            aria-label="Go to page number"
            className="w-full h-8 px-2 text-sm rounded-md border border-slate-300 focus:border-layah-primary focus:outline-none focus:ring-2 focus:ring-layah-primary/20"
          />
        </form>
        <div role="group" aria-label="Thumbnail size" className="flex rounded-md border border-slate-300 overflow-hidden shrink-0">
          {(Object.keys(SIZES) as Size[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={size === s}
              title={`${s === "S" ? "Small" : s === "M" ? "Medium" : "Large"} thumbnails`}
              onClick={() => pickSize(s)}
              className={`h-8 w-7 text-xs font-semibold ${size === s ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Status: busy / error / done + undo */}
      {(busy || actionError || notice || undo) && (
        <div aria-live="polite" className={`px-3 py-2 border-b text-xs flex items-center gap-2 ${actionError ? "bg-red-50 border-red-200 text-red-700" : "bg-blue-50 border-blue-100 text-slate-700"}`}>
          <span className="flex-1 min-w-0 truncate" title={actionError ?? busy ?? notice ?? undo?.label}>
            {actionError ?? (busy ? `${busy}…` : notice ?? undo?.label)}
          </span>
          {undo && !busy && canEdit && (
            <button type="button" onClick={doUndo} title="Undo (Ctrl+Z)" className="flex items-center gap-1 font-semibold text-layah-primary hover:underline shrink-0">
              <Icon d={ICONS.undo} className="w-3.5 h-3.5" />Undo
            </button>
          )}
          {(actionError || notice) && (
            <button type="button" aria-label="Dismiss" onClick={() => { setActionError(null); setNotice(null); }} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
          )}
        </div>
      )}

      {/* Pages list: arrow keys move, R / Shift+R rotate, Delete removes, Ctrl+Z undoes */}
      <div
        ref={listRef}
        data-thumbs
        tabIndex={0}
        onKeyDown={onKey}
        aria-label="Page list. Arrow keys move between pages, R rotates, Delete removes, Ctrl+Z undoes."
        className="flex-1 overflow-y-auto p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-layah-primary/40"
      >
        <Document
          file={file}
          onLoadSuccess={({ numPages: count }) => setNumPages(count)}
          loading={<div className="text-center py-6 text-sm text-slate-500 animate-pulse">Loading pages…</div>}
          error={<div className="text-center py-6 text-sm text-slate-500">Thumbnails unavailable</div>}
          className="space-y-3"
        >
          {Array.from({ length: numPages }, (_, idx) => {
            const isCurrent = idx === current;
            return (
              <div
                key={`thumb-${idx}`}
                data-thumb={idx}
                onClick={() => select(idx)}
                aria-current={isCurrent ? "page" : undefined}
                className={`relative rounded-xl border-2 transition-all cursor-pointer p-2 flex flex-col items-center ${
                  isCurrent ? "border-layah-primary bg-blue-50 shadow-md" : "border-slate-200 bg-slate-50 hover:border-slate-400 hover:shadow-sm"
                }`}
              >
                <div className="relative overflow-hidden rounded bg-white shadow-sm border border-slate-200" style={{ width }}>
                  <Page
                    pageNumber={idx + 1}
                    width={width}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    loading={<div className="bg-slate-100 animate-pulse" style={{ width, height: width * 1.3 }} />}
                  />
                  {/* Large page number, readable at a glance */}
                  <span className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 min-w-7 px-2 py-0.5 rounded-full text-xs font-bold text-center shadow ${
                    isCurrent ? "bg-layah-primary text-white" : "bg-slate-800/80 text-white"
                  }`}>
                    {idx + 1}
                  </span>
                </div>

                {/* Actions: always visible, so they work on touch screens too */}
                {(canEdit || onExtractOutput) && (
                  <div className="w-full flex items-center justify-center gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <>
                        <button type="button" title="Rotate left (Shift+R)" aria-label={`Rotate page ${idx + 1} left`} disabled={!!busy} onClick={() => rotate(idx, 270)} className={actionBtn}>
                          <Icon d={ICONS.rotateLeft} />
                        </button>
                        <button type="button" title="Rotate right (R)" aria-label={`Rotate page ${idx + 1} right`} disabled={!!busy} onClick={() => rotate(idx, 90)} className={actionBtn}>
                          <Icon d={ICONS.rotateRight} />
                        </button>
                      </>
                    )}
                    {onExtractOutput && (
                      <button type="button" title="Save this page as its own PDF" aria-label={`Extract page ${idx + 1}`} disabled={!!busy} onClick={() => extract(idx)} className={actionBtn}>
                        <Icon d={ICONS.extract} />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        title={numPages <= 1 ? "Can't delete the only page" : "Delete page (Delete) — you can undo"}
                        aria-label={`Delete page ${idx + 1}`}
                        disabled={!!busy || numPages <= 1}
                        onClick={() => remove(idx)}
                        className={`${actionBtn} hover:!text-red-600 hover:!border-red-300 hover:!bg-red-50`}
                      >
                        <Icon d={ICONS.delete} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Document>
      </div>
    </aside>
  );
}
