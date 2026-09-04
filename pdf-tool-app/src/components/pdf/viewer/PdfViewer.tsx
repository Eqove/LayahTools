"use client";

import React, { useState, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PdfViewerToolbar } from "./PdfViewerToolbar";

// Configure worker to use UNPKG CDN to avoid Next.js Webpack/Turbopack bundling issues
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  file: File | null;
}

export function PdfViewer({ file }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when file changes
  useEffect(() => {
    setNumPages(0);
    setCurrentPage(1);
    setError(null);
  }, [file]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setCurrentPage(1);
    setError(null);
  }

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

  const scrollToPage = (pageNumber: number) => {
    if (!containerRef.current) return;
    const pageEl = containerRef.current.querySelector(`[data-page-number="${pageNumber}"]`);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));

  if (!file) return null;

  return (
    <div className="w-full h-full flex flex-col bg-[#e4e7ec] overflow-hidden rounded-xl border border-slate-200 shadow-sm relative">
      <PdfViewerToolbar 
        currentPage={currentPage}
        numPages={numPages}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onSetZoom={setZoom}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
      />
      
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto relative outline-none py-8 px-4"
        tabIndex={0}
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <svg className="w-12 h-12 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <p className="font-medium text-slate-900 mb-1">Could not render document</p>
            <p className="text-sm max-w-md text-center">{error}</p>
          </div>
        ) : (
          <Document
            file={file}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center py-20 text-slate-500">
                <span className="animate-pulse">Loading PDF...</span>
              </div>
            }
            className="flex flex-col items-center gap-6 pb-24"
          >
            {Array.from(new Array(numPages), (el, index) => (
              <div 
                key={`page_${index + 1}`} 
                data-page-number={index + 1}
                className="bg-white shadow-md transition-transform"
              >
                <Page
                  pageNumber={index + 1}
                  scale={zoom}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  loading={<div className="bg-white animate-pulse" style={{ width: 600 * zoom, height: 800 * zoom }} />}
                  className="max-w-full"
                />
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
