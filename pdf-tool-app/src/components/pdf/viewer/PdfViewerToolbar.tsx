import React from "react";
import clsx from "clsx";
import { ZOOM_MAX, ZOOM_MIN } from "@/lib/viewer/navigation";

interface PdfViewerToolbarProps {
  currentPage: number;
  numPages: number;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetZoom: (zoom: number) => void;
  /** Fit the current page to the visible width / whole page (omitted where the view has no fit). */
  onFit?: (mode: "width" | "page") => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  /** Optional tools shown at the start of the same row (e.g. the editor's tool buttons). */
  start?: React.ReactNode;
}

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function PdfViewerToolbar({
  currentPage,
  numPages,
  zoom,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  onFit,
  onPrevPage,
  onNextPage,
  start,
}: PdfViewerToolbarProps) {
  return (
    <div className="min-h-10 bg-white border-b border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1 shrink-0">
      {start && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 flex-1 basis-full sm:basis-0">{start}</div>}
      
      {/* Pagination Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onPrevPage}
          disabled={currentPage <= 1}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Previous Page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-sm font-medium text-slate-700 px-2 min-w-[4rem] text-center">
          {currentPage} / {numPages || "?"}
        </div>
        <button
          onClick={onNextPage}
          disabled={currentPage >= numPages}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Next Page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          disabled={zoom <= ZOOM_MIN}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
        </button>
        
        <select 
          value={String(zoom)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "fit-width" || v === "fit-page") onFit?.(v === "fit-width" ? "width" : "page");
            else onSetZoom(parseFloat(v));
          }}
          title="Zoom (Ctrl + scroll to zoom at the pointer)"
          className="text-sm font-medium text-slate-700 bg-transparent border-none focus:ring-0 cursor-pointer appearance-none px-2 text-center"
        >
          {!PRESETS.includes(zoom) && <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>}
          <option value={0.5}>50%</option>
          <option value={0.75}>75%</option>
          <option value={1}>100%</option>
          <option value={1.25}>125%</option>
          <option value={1.5}>150%</option>
          <option value={2}>200%</option>
          <option value={3}>300%</option>
          {onFit && <option value="fit-width">Fit width</option>}
          {onFit && <option value="fit-page">Fit page</option>}
        </select>

        <button
          onClick={onZoomIn}
          disabled={zoom >= ZOOM_MAX}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom In"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
      </div>

    </div>
  );
}
