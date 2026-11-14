"use client";

import React, { useState, useEffect } from "react";
import { Document, Page } from "react-pdf";
import { rotateSinglePage, deleteSinglePage, extractSinglePage } from "@/lib/pdf/page-actions";

interface PageThumbnailSidebarProps {
  file: File;
  activePageIndex?: number;
  onPageSelect?: (pageIndex: number) => void;
  onFileModified?: (file: File) => void;
  onExtractOutput?: (extractedFile: File) => void;
}

export function PageThumbnailSidebar({
  file,
  activePageIndex = 0,
  onPageSelect,
  onFileModified,
  onExtractOutput,
}: PageThumbnailSidebarProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset page count on file change
  useEffect(() => {
    setNumPages(0);
    setActionError(null);
  }, [file]);

  async function handleRotate(pageIndex: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (isBusy || !onFileModified) return;
    setIsBusy(true);
    setActionError(null);
    try {
      const updated = await rotateSinglePage(file, pageIndex, 90);
      onFileModified(updated);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to rotate page.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(pageIndex: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (isBusy || !onFileModified) return;
    if (numPages <= 1) {
      setActionError("Cannot delete the only page in the document.");
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      const updated = await deleteSinglePage(file, pageIndex);
      onFileModified(updated);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to delete page.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExtract(pageIndex: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (isBusy || !onExtractOutput) return;
    setIsBusy(true);
    setActionError(null);
    try {
      const extracted = await extractSinglePage(file, pageIndex);
      onExtractOutput(extracted);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to extract page.");
    } finally {
      setIsBusy(false);
    }
  }

  if (isCollapsed) {
    return (
      <div className="w-10 bg-white border-r border-slate-200 flex flex-col items-center py-3 shrink-0 select-none">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          title="Expand page thumbnails"
          aria-label="Expand page thumbnails"
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
        <span className="mt-4 [writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Pages ({numPages || "-"})
        </span>
      </div>
    );
  }

  return (
    <aside
      aria-label="Document pages"
      className="w-48 bg-white border-r border-slate-200 flex flex-col shrink-0 select-none relative"
    >
      {/* Header */}
      <div className="h-10 px-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
          Pages {numPages > 0 ? `(${numPages})` : ""}
        </span>
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          title="Collapse page thumbnails"
          aria-label="Collapse page thumbnails"
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {actionError && (
        <div className="p-2 bg-red-50 border-b border-red-200 text-[11px] text-red-700 flex justify-between items-center">
          <span className="truncate">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-500 hover:text-red-700 ml-1">✕</button>
        </div>
      )}

      {/* Pages list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <Document
          file={file}
          onLoadSuccess={({ numPages: count }) => setNumPages(count)}
          loading={
            <div className="text-center py-6 text-xs text-slate-400 animate-pulse">
              Loading pages...
            </div>
          }
          error={
            <div className="text-center py-6 text-xs text-slate-400">
              Thumbnails unavailable
            </div>
          }
        >
          {Array.from({ length: numPages }, (_, idx) => {
            const isCurrent = idx === activePageIndex;
            return (
              <div
                key={`thumb-${idx}`}
                onClick={() => onPageSelect?.(idx)}
                className={`group relative rounded-lg border transition-all cursor-pointer p-1.5 flex flex-col items-center bg-slate-50 ${
                  isCurrent
                    ? "border-layah-primary ring-1 ring-layah-primary/30 bg-blue-50/40"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                {/* Thumbnail Page Container */}
                <div className="w-[120px] overflow-hidden rounded bg-white shadow-xs border border-slate-100 flex items-center justify-center">
                  <Page
                    pageNumber={idx + 1}
                    width={120}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    loading={
                      <div className="h-36 w-[120px] bg-slate-100 flex items-center justify-center text-[10px] text-slate-400">
                        p. {idx + 1}
                      </div>
                    }
                  />
                </div>

                {/* Page number badge & hover actions */}
                <div className="w-full flex items-center justify-between mt-1 px-1 text-slate-600">
                  <span className="text-[11px] font-mono font-medium text-slate-500">
                    #{idx + 1}
                  </span>

                  {/* Quick actions (visible on hover or focus) */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      title="Rotate 90° clockwise"
                      aria-label={`Rotate page ${idx + 1}`}
                      disabled={isBusy}
                      onClick={(e) => handleRotate(idx, e)}
                      className="p-1 text-slate-400 hover:text-layah-primary hover:bg-white rounded transition-colors disabled:opacity-30"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      title="Extract this page"
                      aria-label={`Extract page ${idx + 1}`}
                      disabled={isBusy}
                      onClick={(e) => handleExtract(idx, e)}
                      className="p-1 text-slate-400 hover:text-layah-primary hover:bg-white rounded transition-colors disabled:opacity-30"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      title="Delete this page"
                      aria-label={`Delete page ${idx + 1}`}
                      disabled={isBusy || numPages <= 1}
                      onClick={(e) => handleDelete(idx, e)}
                      className="p-1 text-slate-400 hover:text-red-600 hover:bg-white rounded transition-colors disabled:opacity-20"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </Document>
      </div>
    </aside>
  );
}
