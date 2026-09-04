import React from "react";
import clsx from "clsx";

interface PdfViewerToolbarProps {
  currentPage: number;
  numPages: number;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetZoom: (zoom: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export function PdfViewerToolbar({
  currentPage,
  numPages,
  zoom,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  onPrevPage,
  onNextPage,
}: PdfViewerToolbarProps) {
  return (
    <div className="h-12 bg-white border-b border-slate-200 shadow-sm flex items-center justify-between px-4 shrink-0">
      
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
          disabled={zoom <= 0.5}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
        </button>
        
        <select 
          value={zoom}
          onChange={(e) => onSetZoom(parseFloat(e.target.value))}
          className="text-sm font-medium text-slate-700 bg-transparent border-none focus:ring-0 cursor-pointer appearance-none px-2 text-center"
        >
          <option value={0.5}>50%</option>
          <option value={0.75}>75%</option>
          <option value={1}>100%</option>
          <option value={1.25}>125%</option>
          <option value={1.5}>150%</option>
          <option value={2}>200%</option>
        </select>

        <button
          onClick={onZoomIn}
          disabled={zoom >= 3}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Zoom In"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
      </div>

    </div>
  );
}
