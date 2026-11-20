"use client";

import React, { useEffect, useRef, useState } from "react";

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

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: { id: Corner; pos: string; cursor: string }[] = [
  { id: "nw", pos: "-left-3.5 -top-3.5", cursor: "cursor-nwse-resize" },
  { id: "ne", pos: "-right-3.5 -top-3.5", cursor: "cursor-nesw-resize" },
  { id: "sw", pos: "-left-3.5 -bottom-3.5", cursor: "cursor-nesw-resize" },
  { id: "se", pos: "-right-3.5 -bottom-3.5", cursor: "cursor-nwse-resize" },
];
const MIN_WIDTH_PX = 28;

const imageAspect = (src: string) =>
  new Promise<number>((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i.naturalWidth && i.naturalHeight ? i.naturalWidth / i.naturalHeight : 2.5);
    i.onerror = () => resolve(2.5);
    i.src = src;
  });

/**
 * Click the page to place the signature. Click a placed one to select it: drag it to move, drag a corner to resize
 * (its shape is kept), × to remove, Delete/Backspace also removes it. Click empty page to deselect.
 */
export function SignOverlay({ pageIndex, signatures, onChange, activeSignatureDataUrl }: SignOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // One gesture at a time: moving, or resizing from a corner.
  const gesture = useRef<
    | { kind: "move"; id: string; px: number; py: number; x: number; y: number }
    | { kind: "resize"; id: string; corner: Corner; ax: number; ay: number; ratio: number }
    | null
  >(null);
  const sigRef = useRef(signatures);
  useEffect(() => { sigRef.current = signatures; }, [signatures]);

  const pageSignatures = signatures.filter((s) => s.pageIndex === pageIndex);

  const update = (id: string, patch: Partial<SignaturePlacement>) =>
    onChange(sigRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => { onChange(sigRef.current.filter((s) => s.id !== id)); setSelectedId(null); };

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (sigRef.current.some((s) => s.id === selectedId && s.pageIndex === pageIndex)) remove(selectedId); }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remove() reads the latest list through a ref
  }, [selectedId, pageIndex]);

  const handleContainerClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeSignatureDataUrl || !containerRef.current) return;
    if ((e.target as HTMLElement).closest(".signature-item")) return;
    // First tap on empty page only deselects; the next one places another signature.
    if (selectedId) { setSelectedId(null); return; }

    const rect = containerRef.current.getBoundingClientRect();
    const aspect = await imageAspect(activeSignatureDataUrl);
    const width = 0.25;
    const height = (width * rect.width) / rect.height / aspect; // keeps the image's own shape on the page
    const id = Math.random().toString(36).substring(2, 9);
    onChange([...sigRef.current, {
      id,
      pageIndex,
      dataUrl: activeSignatureDataUrl,
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width - width / 2, 0), 1 - width),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height - height / 2, 0), 1 - height),
      width,
      height,
    }]);
    setSelectedId(id);
  };

  const startMove = (e: React.PointerEvent<HTMLElement>, sig: SignaturePlacement) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(sig.id);
    gesture.current = { kind: "move", id: sig.id, px: e.clientX, py: e.clientY, x: sig.x, y: sig.y };
  };

  const startResize = (e: React.PointerEvent<HTMLElement>, sig: SignaturePlacement, corner: Corner) => {
    if (!containerRef.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = containerRef.current.getBoundingClientRect();
    const L = sig.x * r.width, T = sig.y * r.height, W = sig.width * r.width, H = sig.height * r.height;
    // The corner opposite the one being dragged stays where it is.
    const ax = corner === "nw" || corner === "sw" ? L + W : L;
    const ay = corner === "nw" || corner === "ne" ? T + H : T;
    gesture.current = { kind: "resize", id: sig.id, corner, ax, ay, ratio: W / H };
  };

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    const c = containerRef.current;
    if (!g || !c) return;
    const r = c.getBoundingClientRect();
    if (g.kind === "move") {
      update(g.id, { x: g.x + (e.clientX - g.px) / r.width, y: g.y + (e.clientY - g.py) / r.height });
      return;
    }
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let w = Math.max(Math.abs(px - g.ax), Math.abs(py - g.ay) * g.ratio);
    w = Math.min(Math.max(w, MIN_WIDTH_PX), r.width, r.height * g.ratio);
    const h = w / g.ratio;
    const left = g.corner === "nw" || g.corner === "sw" ? g.ax - w : g.ax;
    const top = g.corner === "nw" || g.corner === "ne" ? g.ay - h : g.ay;
    update(g.id, { x: left / r.width, y: top / r.height, width: w / r.width, height: h / r.height });
  };

  const endGesture = (e: React.PointerEvent<HTMLElement>) => {
    if (!gesture.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    gesture.current = null;
  };

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-20 ${activeSignatureDataUrl ? "cursor-crosshair" : ""} touch-none`}
      onClick={handleContainerClick}
    >
      {pageSignatures.map((sig) => {
        const isSel = sig.id === selectedId;
        return (
          <div
            key={sig.id}
            className={`absolute group signature-item touch-none ${isSel ? "z-30" : ""}`}
            style={{ left: `${sig.x * 100}%`, top: `${sig.y * 100}%`, width: `${sig.width * 100}%`, height: `${sig.height * 100}%` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sig.dataUrl}
              alt="Signature"
              className={`w-full h-full object-contain cursor-move select-none ${isSel ? "ring-2 ring-blue-500 bg-blue-500/5" : "hover:ring-2 hover:ring-blue-400"}`}
              onPointerDown={(e) => startMove(e, sig)}
              onPointerMove={onMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              draggable={false}
            />
            {isSel && (
              <>
                {CORNERS.map((c) => (
                  <span
                    key={c.id}
                    role="button"
                    aria-label={`Resize signature from ${c.id} corner`}
                    className={`absolute ${c.pos} w-7 h-7 flex items-center justify-center touch-none ${c.cursor}`}
                    onPointerDown={(e) => startResize(e, sig, c.id)}
                    onPointerMove={onMove}
                    onPointerUp={endGesture}
                    onPointerCancel={endGesture}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-500 shadow" />
                  </span>
                ))}
                <button
                  type="button"
                  aria-label="Remove signature"
                  title="Remove (Delete)"
                  onClick={(e) => { e.stopPropagation(); remove(sig.id); }}
                  className="absolute left-1/2 -translate-x-1/2 -top-11 h-8 px-3 rounded-full bg-slate-900 text-white text-xs font-medium flex items-center gap-1.5 shadow-lg whitespace-nowrap"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Remove
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
