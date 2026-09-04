"use client";

import React, { useState, useRef } from "react";

export interface RedactionRect {
  id: string;
  pageIndex: number;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  width: number; // normalized 0-1
  height: number; // normalized 0-1
}

interface RedactOverlayProps {
  pageIndex: number;
  redactions: RedactionRect[];
  onChange: (redactions: RedactionRect[]) => void;
}

export function RedactOverlay({ pageIndex, redactions, onChange }: RedactOverlayProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const pageRedactions = redactions.filter((r) => r.pageIndex === pageIndex);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only left click
    if (e.button !== 0) return;
    if (!containerRef.current) return;
    
    // Ignore clicks on existing redaction delete buttons
    if ((e.target as HTMLElement).closest('button')) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    startPos.current = { x, y };
    setIsDrawing(true);
    setCurrentBox({ x, y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const x = Math.min(startPos.current.x, currentX);
    const y = Math.min(startPos.current.y, currentY);
    const w = Math.abs(currentX - startPos.current.x);
    const h = Math.abs(currentY - startPos.current.y);

    setCurrentBox({ x, y, w, h });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (currentBox && currentBox.w > 10 && currentBox.h > 10 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const newRedaction: RedactionRect = {
        id: Math.random().toString(36).substring(2, 9),
        pageIndex,
        x: currentBox.x / rect.width,
        y: currentBox.y / rect.height,
        width: currentBox.w / rect.width,
        height: currentBox.h / rect.height,
      };
      onChange([...redactions, newRedaction]);
    }
    setCurrentBox(null);
  };

  const removeRedaction = (id: string) => {
    onChange(redactions.filter((r) => r.id !== id));
  };

  return (
    <div 
      ref={containerRef}
      className="absolute inset-0 z-20 cursor-crosshair touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Existing Redactions */}
      {pageRedactions.map((r) => (
        <div
          key={r.id}
          className="absolute bg-black group"
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.width * 100}%`,
            height: `${r.height * 100}%`,
          }}
        >
          <button
            onClick={() => removeRedaction(r.id)}
            className="absolute -top-3 -right-3 bg-red-500 text-white w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md z-30 cursor-pointer"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      ))}

      {/* Currently Drawing Box */}
      {isDrawing && currentBox && (
        <div
          className="absolute border-2 border-black bg-black/30 pointer-events-none"
          style={{
            left: `${currentBox.x}px`,
            top: `${currentBox.y}px`,
            width: `${currentBox.w}px`,
            height: `${currentBox.h}px`,
          }}
        />
      )}
    </div>
  );
}
