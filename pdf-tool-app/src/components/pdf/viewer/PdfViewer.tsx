"use client";

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PdfViewerToolbar } from "./PdfViewerToolbar";
import { PanController, ZOOM_STEP, anchoredScroll, clampZoom, fitZoom, fractionIn, isCurrentRender, keepBackdrop, wheelZoom } from "@/lib/viewer/navigation";

// Configure worker to use UNPKG CDN to avoid Next.js Webpack/Turbopack bundling issues
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  file: File | null;
  renderPageOverlay?: (pageIndex: number) => React.ReactNode;
  /** Keep scroll position (and page) when `file` is swapped for an edited version of itself. */
  preserveScroll?: boolean;
  viewMode?: "scroll" | "grid";
  pageOrder?: number[];
  onPageReorder?: (newOrder: number[]) => void;
  /** Extra controls placed at the start of the page/zoom toolbar row. */
  toolbarStart?: React.ReactNode;
  /** Hand tool: a left drag pans the view (Space and middle drag pan in any tool). */
  handTool?: boolean;
}

export function PdfViewer({ 
  file, 
  renderPageOverlay, 
  preserveScroll = false,
  viewMode = "scroll", 
  pageOrder, 
  onPageReorder,
  toolbarStart,
  handTool = false
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  // Phones start zoomed out so a whole page width fits; the toolbar zoom still works.
  const [zoom, setZoom] = useState<number>(() => (typeof window !== "undefined" && window.innerWidth < 480 ? 0.5 : 1));
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Double buffering (preserveScroll): a changed `file` loads and renders in a hidden second <Document>;
  // the visible one keeps showing the old pages until the new ones have painted, then they swap.
  // This avoids react-pdf's loading state, which unmounts every page (the "flicker") whenever `file` changes.
  const [shown, setShown] = useState<File | null>(file);
  const incoming = preserveScroll && file && shown && file !== shown ? file : null;
  const incomingPages = useRef(0);
  const incomingRendered = useRef(0);
  const keys = useRef({ map: new WeakMap<File, number>(), next: 1 });
  const keyOf = (f: File) => {
    if (!keys.current.map.has(f)) keys.current.map.set(f, keys.current.next++);
    return keys.current.map.get(f)!;
  };
  const swap = () => {
    if (!incoming) return;
    setNumPages(incomingPages.current || numPages);
    setShown(incoming);
  };
  const swapRef = useRef(swap);
  swapRef.current = swap;
  useEffect(() => {
    if (!incoming) return;
    incomingPages.current = 0;
    incomingRendered.current = 0;
    // Safety net: never leave a stale document up if a page is slow or fails to render.
    const t = setTimeout(() => swapRef.current(), 4000);
    return () => clearTimeout(t);
  }, [incoming]);

  // Non-buffered viewers (other tools) reset when the file changes.
  useEffect(() => {
    if (!preserveScroll) {
      setNumPages(0);
      setCurrentPage(1);
    }
    setError(null);
  }, [file, preserveScroll]);

  const [internalPageOrder, setInternalPageOrder] = useState<number[]>([]);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    if (!preserveScroll) setCurrentPage(1);
    setError(null);
    if (!pageOrder || pageOrder.length !== numPages) {
      const order = Array.from({ length: numPages }, (_, i) => i);
      setInternalPageOrder(order);
      if (onPageReorder) onPageReorder(order);
    } else {
      setInternalPageOrder(pageOrder);
    }
  }

  useEffect(() => {
    if (pageOrder) {
      setInternalPageOrder(pageOrder);
    }
  }, [pageOrder]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIndex) return;

    const newOrder = [...internalPageOrder];
    const [draggedItem] = newOrder.splice(draggedIdx, 1);
    newOrder.splice(targetIndex, 0, draggedItem);
    
    setInternalPageOrder(newOrder);
    if (onPageReorder) onPageReorder(newOrder);
    setDraggedIdx(null);
  };

  // Tracking scroll and page view ...
  function onDocumentLoadError(error: Error) {
    console.error("Failed to load PDF", error);
    setError("Failed to load the PDF document. It may be corrupted or password protected.");
  }

  // Support infinite scroll simulation vs discrete pages.
  // For V1, we'll render all pages efficiently, or just render the current page depending on complexity.
  // The instruction says: "scroll through multiple pages... virtualized if necessary... prioritize correctness and smoothness"
  // Let's render all pages sequentially in a scrollable list. react-pdf handles viewport rendering decently if lazy.
  
  // Track visible page
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    
    const handleScroll = () => {
      // Very naive visibility calculation to update currentPage in toolbar
      const pageElements = container.querySelectorAll('.react-pdf__Page');
      let visiblePage = currentPage;
      
      for (let i = 0; i < pageElements.length; i++) {
        const el = pageElements[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        // If the top of the page is within the top half of the container
        if (rect.top >= 0 && rect.top <= container.clientHeight / 2) {
          visiblePage = i + 1;
          break;
        } else if (rect.top < 0 && rect.bottom > container.clientHeight / 2) {
          visiblePage = i + 1;
          break;
        }
      }
      
      if (visiblePage !== currentPage) {
        setCurrentPage(visiblePage);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [currentPage]);

  const handlePrevPage = () => {
    const newPage = Math.max(currentPage - 1, 1);
    setCurrentPage(newPage);
    scrollToPage(newPage);
  };

  const handleNextPage = () => {
    const newPage = Math.min(currentPage + 1, numPages);
    setCurrentPage(newPage);
    scrollToPage(newPage);
  };

  const scrollToPage = (pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return;
    const pageEl = containerRef.current.querySelector(`[data-page-number="${pageNumber}"]`);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior, block: 'start' });
    }
  };

  // ---- navigation (zoom + pan): changes scale and scroll only, never the document -------------------
  // Page sizes at zoom 1 (CSS px), so each page box can be sized in the same render as the zoom change and the
  // scroll correction below can measure the new layout before paint (react-pdf sizes its canvas only later).
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  const anchor = useRef<{ page: number; f: { x: number; y: number }; p: { x: number; y: number } } | null>(null);
  const zoomRef = useRef(zoom); // only zoomTo changes zoom, so this is always the latest value, even mid-burst
  const nav = viewMode === "scroll";
  const PAGE_SEL = ":scope > div:not([aria-hidden]) [data-page-number]";

  const pageElAt = (p: { x: number; y: number }) => {
    let best: HTMLElement | null = null, bestD = Infinity;
    for (const el of Array.from(containerRef.current?.querySelectorAll<HTMLElement>(PAGE_SEL) ?? [])) {
      const r = el.getBoundingClientRect();
      const d = p.y < r.top ? r.top - p.y : p.y > r.bottom ? p.y - r.bottom : 0;
      if (d < bestD) { bestD = d; best = el; }
    }
    return best;
  };
  /** Change zoom keeping the document point under client point `p` (default: centre of the view) in place. */
  const zoomTo = (next: number, p?: { x: number; y: number }) => {
    const z = clampZoom(next);
    const c = containerRef.current;
    if (!c || z === zoomRef.current) return;
    const r = c.getBoundingClientRect();
    const at = p ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const el = pageElAt(at);
    anchor.current = el ? { page: Number(el.dataset.pageNumber), f: fractionIn(at, el.getBoundingClientRect()), p: at } : null;
    // react-pdf blanks and hides each canvas while it redraws at the new scale. Keep a copy of the last finished
    // frame under it, stretched to the new page box, until the new render is done (removed in onRenderSuccess).
    for (const box of Array.from(c.querySelectorAll<HTMLElement>(":scope > div:not([aria-hidden]) [data-zoom-backdrop]"))) {
      const src = box.parentElement?.querySelector<HTMLCanvasElement>(".react-pdf__Page__canvas");
      const b = box.getBoundingClientRect();
      if (!src || !keepBackdrop({ canvasRendered: src.width > 0 && src.style.visibility !== "hidden", hasBackdrop: !!box.firstChild, onScreen: b.bottom > r.top && b.top < r.bottom && b.right > r.left && b.left < r.right })) continue;
      const copy = document.createElement("canvas");
      copy.width = src.width; copy.height = src.height;
      copy.style.cssText = "width:100%;height:100%;display:block";
      copy.getContext("2d")?.drawImage(src, 0, 0);
      box.appendChild(copy);
    }
    zoomRef.current = z;
    setZoom(z);
  };
  useLayoutEffect(() => {
    const a = anchor.current, c = containerRef.current;
    anchor.current = null;
    if (!a || !c) return;
    const el = c.querySelector<HTMLElement>(`:scope > div:not([aria-hidden]) [data-page-number="${a.page}"]`);
    if (!el) return;
    const s = anchoredScroll({ left: c.scrollLeft, top: c.scrollTop }, a.p, el.getBoundingClientRect(), a.f);
    c.scrollLeft = s.left;
    c.scrollTop = s.top;
  }, [zoom]);

  const dropBackdrop = (pageNum: number) =>
    containerRef.current?.querySelector(`:scope > div:not([aria-hidden]) [data-page-number="${pageNum}"] [data-zoom-backdrop]`)?.replaceChildren();
  const zoomToRef = useRef(zoomTo);
  useLayoutEffect(() => { zoomToRef.current = zoomTo; });
  const zoomIn = () => zoomTo(zoomRef.current + ZOOM_STEP);
  const zoomOut = () => zoomTo(zoomRef.current - ZOOM_STEP);
  const fit = (mode: "width" | "page") => {
    const c = containerRef.current;
    const size = pageSizes[currentPage] ?? pageSizes[1];
    if (!c || !size) return;
    const cs = getComputedStyle(c);
    const area = {
      width: c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      height: c.clientHeight - 2 * parseFloat(cs.paddingTop),
    };
    zoomTo(fitZoom(mode, { width: size.w, height: size.h }, area));
    if (mode === "page") requestAnimationFrame(() => scrollToPage(currentPage, "auto"));
  };

  // Ctrl/Cmd + wheel (and trackpad pinch, delivered as ctrl+wheel) zooms at the pointer. React's onWheel is passive,
  // so preventDefault (which stops the browser's own page zoom) needs a native listener. Batched to one zoom per frame.
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !nav) return;
    let pending: { z: number; p: { x: number; y: number } } | null = null, frame = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel / two-finger scroll: native scrolling
      e.preventDefault();
      pending = { z: wheelZoom(pending?.z ?? zoomRef.current, e.deltaY, e.deltaMode), p: { x: e.clientX, y: e.clientY } };
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (pending) zoomToRef.current(pending.z, pending.p); pending = null; });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => { c.removeEventListener("wheel", onWheel); cancelAnimationFrame(frame); };
  }, [nav]);

  // Temporary pan: Space + left drag or middle drag. Claimed in the capture phase so the page overlay (selection,
  // marquee, object drag) never sees the press; the active tool stays as it is.
  const [pan] = useState(() => new PanController());
  const [panUi, setPanUi] = useState<"off" | "ready" | "panning">("off");
  const hovered = useRef(false);
  const syncPanUi = useCallback(() => setPanUi(pan.phase === "panning" ? "panning" : (pan.spaceHeld || pan.hand) && hovered.current ? "ready" : "off"), [pan]);
  useEffect(() => { pan.hand = nav && handTool; syncPanUi(); }, [pan, nav, handTool, syncPanUi]);
  useEffect(() => {
    if (!nav) return;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pan.escape()) { e.preventDefault(); e.stopImmediatePropagation(); syncPanUi(); return; }
      if (e.key !== " " || typing(e.target) || !(hovered.current || pan.phase !== "idle")) return;
      e.preventDefault(); // no page scroll, no button activation
      e.stopImmediatePropagation();
      if (!e.repeat) { pan.keyDown(" "); syncPanUi(); }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== " " || !pan.spaceHeld) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pan.keyUp(" ");
      syncPanUi();
    };
    const onBlur = () => { pan.blur(); syncPanUi(); };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onDown, true); window.removeEventListener("keyup", onUp, true); window.removeEventListener("blur", onBlur); };
  }, [nav, pan, syncPanUi]);
  const endPan = (e: React.PointerEvent) => { if (pan.owns(e.pointerId)) { e.stopPropagation(); pan.cancel(e.pointerId); syncPanUi(); } };
  const panHandlers = nav ? {
    onPointerEnter: () => { hovered.current = true; syncPanUi(); },
    onPointerLeave: () => { hovered.current = false; syncPanUi(); },
    onPointerDownCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pan.down(e.pointerId, e.button, { x: e.clientX, y: e.clientY })) return;
      e.stopPropagation(); // never reaches the page overlay
      e.preventDefault(); // no text selection, no middle-button autoscroll
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      syncPanUi();
    },
    onPointerMoveCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pan.owns(e.pointerId)) return;
      e.stopPropagation();
      const d = pan.drag(e.pointerId, { x: e.clientX, y: e.clientY });
      if (d) { e.currentTarget.scrollLeft += d.x; e.currentTarget.scrollTop += d.y; }
    },
    onPointerUpCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pan.up(e.pointerId)) return;
      e.stopPropagation();
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      syncPanUi();
    },
    onPointerCancelCapture: endPan,
    onLostPointerCaptureCapture: endPan,
    onAuxClickCapture: (e: React.MouseEvent) => { if (e.button === 1) e.preventDefault(); }, // middle click: no link opening
    onMouseDownCapture: (e: React.MouseEvent) => { if (e.button === 1) e.preventDefault(); }, // middle press: no autoscroll
  } : {};

  const renderDoc = (f: File, hidden: boolean) => (
    <div
      key={keyOf(f)}
      aria-hidden={hidden || undefined}
      className={hidden ? "absolute top-0 left-0 right-0 invisible pointer-events-none py-8 px-4" : undefined}
    >
      <Document
        file={f}
        onLoadSuccess={hidden ? ({ numPages: n }) => { incomingPages.current = n; } : onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="flex items-center justify-center py-20 text-slate-500">
            <span className="animate-pulse">Loading PDF...</span>
          </div>
        }
        className={viewMode === "grid"
          ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 p-6 pb-24 max-w-5xl mx-auto"
          : "flex flex-col items-center gap-6 pb-24 w-max min-w-full"}
      >
        {(internalPageOrder.length > 0 ? internalPageOrder : Array.from({ length: numPages }, (_, i) => i)).map((originalIndex, currentIndex) => {
          const pageNum = originalIndex + 1;
          return (
            <div
              key={`page_render_${originalIndex}_${currentIndex}`}
              data-page-number={pageNum}
              className={`bg-white shadow-md transition-transform relative ${
                viewMode === "grid"
                  ? "cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-blue-400"
                  : ""
              } ${draggedIdx === currentIndex ? "opacity-50" : ""}`}
              style={nav && pageSizes[pageNum] ? { width: Math.floor(pageSizes[pageNum].w * zoom), height: Math.floor(pageSizes[pageNum].h * zoom) } : undefined}
              draggable={viewMode === "grid"}
              onDragStart={(e) => viewMode === "grid" && handleDragStart(e, currentIndex)}
              onDragOver={(e) => {
                if (viewMode === "grid") e.preventDefault();
              }}
              onDrop={(e) => viewMode === "grid" && handleDrop(e, currentIndex)}
            >
              {nav && <div data-zoom-backdrop aria-hidden className="absolute inset-0 pointer-events-none" />}
              {viewMode === "grid" && (
                <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center z-10 pointer-events-none">
                  {currentIndex + 1}
                </div>
              )}
              <Page
                pageNumber={pageNum}
                scale={viewMode === "grid" ? 0.3 : zoom}
                renderTextLayer={viewMode !== "grid"}
                renderAnnotationLayer={viewMode !== "grid"}
                onLoadSuccess={hidden ? undefined : (pg) => {
                  const vp = pg.getViewport({ scale: 1 });
                  setPageSizes(m => m[pageNum]?.w === vp.width && m[pageNum]?.h === vp.height ? m : { ...m, [pageNum]: { w: vp.width, h: vp.height } });
                }}
                onRenderSuccess={hidden ? () => {
                  if (++incomingRendered.current >= incomingPages.current && incomingPages.current > 0) swapRef.current();
                } : nav ? (pg) => {
                  // the new frame is on screen: drop the stand-in (only for the current scale, not a superseded one)
                  if (isCurrentRender(pg.width / pg.originalWidth, zoomRef.current)) dropBackdrop(pageNum);
                } : undefined}
                onRenderError={nav && !hidden ? () => dropBackdrop(pageNum) : undefined}
                loading={<div className="bg-white animate-pulse" style={{ width: (viewMode === "grid" ? 180 : 600 * zoom), height: (viewMode === "grid" ? 240 : 800 * zoom) }} />}
                className="max-w-full relative"
              >
                {!hidden && renderPageOverlay && renderPageOverlay(originalIndex)}
              </Page>
            </div>
          );
        })}
      </Document>
    </div>
  );

  if (!file) return null;

  return (
    <div className="w-full h-full flex flex-col bg-[#e4e7ec] overflow-hidden rounded-xl border border-slate-200 shadow-sm relative">
      <PdfViewerToolbar 
        currentPage={currentPage}
        numPages={numPages}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onSetZoom={(z) => zoomTo(z)}
        onFit={nav ? fit : undefined}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        start={toolbarStart}
      />
      
      <div 
        ref={containerRef}
        className={`flex-1 overflow-y-auto overflow-x-auto relative outline-none py-8 px-4 ${panUi === "panning" ? "cursor-grabbing select-none [&_*]:!cursor-grabbing" : panUi === "ready" ? "cursor-grab [&_*]:!cursor-grab" : ""}`}
        tabIndex={0}
        {...panHandlers}
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <svg className="w-12 h-12 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <p className="font-medium text-slate-900 mb-1">Could not render document</p>
            <p className="text-sm max-w-md text-center">{error}</p>
          </div>
        ) : (
          <>
            {renderDoc(preserveScroll ? shown ?? file : file, false)}
            {incoming && renderDoc(incoming, true)}
          </>
        )}
      </div>
    </div>
  );
}
