"use client";

import React, { useRef, useState } from "react";

export interface SignaturePlacement {
  id: string;
  pageIndex: number;
  dataUrl: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  width: number; // normalized 0-1
  height: number; // normalized 0-1
}

interface SignOverlayProps {
  pageIndex: number;
  signatures: SignaturePlacement[];
  onChange: (signatures: SignaturePlacement[]) => void;
  activeSignatureDataUrl: string | null;
}

export function SignOverlay({ pageIndex, signatures, onChange, activeSignatureDataUrl }: SignOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const pageSignatures = signatures.filter((s) => s.pageIndex === pageIndex);

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingId || !activeSignatureDataUrl || !containerRef.current) return;
    
    // Don't place a new signature if clicking on an existing one
    if ((e.target as HTMLElement).closest('.signature-item')) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const defaultWidth = 0.25; // 25% of page width
    const defaultHeight = 0.1; // 10% of page height

    const newSignature: SignaturePlacement = {
      id: Math.random().toString(36).substring(2, 9),
      pageIndex,
      dataUrl: activeSignatureDataUrl,
      x: clickX / rect.width - (defaultWidth / 2),
      y: clickY / rect.height - (defaultHeight / 2),
      width: defaultWidth,
      height: defaultHeight,
    };

    onChange([...signatures, newSignature]);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string, x: number, y: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingId(id);
    dragStart.current = { x: e.clientX, y: e.clientY, startX: x, startY: y };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingId || !dragStart.current || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - dragStart.current.x) / rect.width;
    const dy = (e.clientY - dragStart.current.y) / rect.height;

    const updated = signatures.map(sig => {
      if (sig.id === draggingId) {
        return {
          ...sig,
          x: dragStart.current!.startX + dx,
          y: dragStart.current!.startY + dy,
        };
      }
      return sig;
    });

    onChange(updated);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingId) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDraggingId(null);
      dragStart.current = null;
    }
  };

  const removeSignature = (id: string) => {
    onChange(signatures.filter((s) => s.id !== id));
  };

  return (
    <div 
      ref={containerRef}
      className={`absolute inset-0 z-20 ${activeSignatureDataUrl ? 'cursor-crosshair' : ''} touch-none`}
      onClick={handleContainerClick}
    >
      {pageSignatures.map((sig) => (
        <div
          key={sig.id}
          className="absolute group signature-item touch-none"
          style={{
            left: `${sig.x * 100}%`,
            top: `${sig.y * 100}%`,
            width: `${sig.width * 100}%`,
            height: `${sig.height * 100}%`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src={sig.dataUrl} 
            alt="Signature" 
            className={`w-full h-full object-contain cursor-move ${draggingId === sig.id ? 'opacity-70' : 'hover:ring-2 hover:ring-blue-500'}`}
            onPointerDown={(e) => handlePointerDown(e, sig.id, sig.x, sig.y)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            draggable={false}
          />
          <button
            onClick={(e) => { e.stopPropagation(); removeSignature(sig.id); }}
            className="absolute -top-3 -right-3 bg-red-500 text-white w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md z-30 cursor-pointer"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
