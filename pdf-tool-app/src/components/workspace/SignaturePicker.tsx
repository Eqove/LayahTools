"use client";

import React, { useEffect, useRef, useState } from "react";

interface SignaturePickerProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  placedCount?: number;
  onClearPlaced?: () => void;
  /** "card": the big first-run card shown over the document. "panel": the side configuration panel. */
  variant?: "panel" | "card";
  /** Card only: shows a close button. */
  onClose?: () => void;
}

type Mode = "upload" | "draw" | "type";

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/**
 * Any image the browser can open becomes a PNG (the signer embeds PNG/JPEG only).
 * With `clearPaper`, near-white pixels turn transparent, so a phone photo of a signature on paper
 * doesn't paste a white box over the page. Then the result is cropped to the ink.
 */
async function toSignaturePng(src: string, clearPaper: boolean): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (clearPaper && 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] > 190) px[i + 3] = 0;
      if (px[i + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  ctx.putImageData(data, 0, 0);
  if (x1 < 0) return c.toDataURL("image/png"); // nothing left: keep as is
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

const INK = ["#0f172a", "#1d4ed8", "#b91c1c"];

export function SignaturePicker({ value, onChange, placedCount = 0, onClearPlaced, variant = "panel", onClose }: SignaturePickerProps) {
  const [mode, setMode] = useState<Mode>("upload");
  const [clearPaper, setClearPaper] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [ink, setInk] = useState(INK[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const card = variant === "card";
  useEffect(() => {
    if (!card || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) { setError("That isn't an image. Pick a PNG, JPG or photo of your signature."); return; }
    const url = URL.createObjectURL(file);
    try { onChange(await toSignaturePng(url, clearPaper)); }
    catch { setError("Couldn't open that image. Try a PNG or JPG."); }
    finally { URL.revokeObjectURL(url); }
  };

  // ---- draw pad ----
  const pad = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  useEffect(() => {
    const c = pad.current;
    if (!c || mode !== "draw") return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.6;
    setHasInk(false);
  }, [mode]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const penDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d")!;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    ctx.strokeStyle = ink;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
    setHasInk(true);
  };
  const penMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const penUp = () => { drawing.current = false; };
  const clearPad = () => { const c = pad.current; c?.getContext("2d")!.clearRect(0, 0, c.width, c.height); setHasInk(false); };
  const useDrawing = async () => { if (pad.current && hasInk) onChange(await toSignaturePng(pad.current.toDataURL("image/png"), false)); };

  // ---- typed ----
  const useTyped = async () => {
    const text = typed.trim();
    if (!text) return;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = `italic 64px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(text).width) + 40; c.height = 110;
    ctx.font = font; ctx.fillStyle = ink; ctx.textBaseline = "middle";
    ctx.fillText(text, 20, 55);
    onChange(await toSignaturePng(c.toDataURL("image/png"), false));
  };

  const tab = (m: Mode, label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}
      className={`flex-1 h-9 rounded-md text-sm font-medium transition-colors ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
      {label}
    </button>
  );

  const inkPicker = (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Ink colour">
      {INK.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={ink === c} aria-label={c === INK[0] ? "Black ink" : c === INK[1] ? "Blue ink" : "Red ink"}
          onClick={() => setInk(c)} style={{ background: c }}
          className={`w-6 h-6 rounded-full ring-offset-2 ${ink === c ? "ring-2 ring-blue-500" : ""}`} />
      ))}
    </div>
  );

  // ---- signature ready ----
  if (value) {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center">✓</span>
          Your signature
        </div>
        <div className="rounded-xl border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] [background-size:16px_16px] p-3 flex items-center justify-center h-28">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          <img src={value} alt="Your signature" className="max-h-full max-w-full object-contain" />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange(null)} className="flex-1 h-9 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50">Change signature</button>
        </div>
        <ol className="text-sm text-slate-700 bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1.5">
          <li><b>1.</b> Click anywhere on a page to place it.</li>
          <li><b>2.</b> Drag it to move it. Drag a corner dot to resize.</li>
          <li><b>3.</b> Press <b>Run Tool</b> to save the signed PDF.</li>
        </ol>
        {placedCount > 0 && (
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>{placedCount} placed on the document</span>
            {onClearPlaced && <button type="button" onClick={onClearPlaced} className="text-red-600 font-medium hover:underline">Remove all</button>}
          </div>
        )}
      </div>
    );
  }

  // ---- add a signature ----
  return (
    <div className={`relative flex flex-col gap-3 ${card ? "w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-5" : ""}`}>
      {card && onClose && (
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}
      <div className={card ? "pr-10" : ""}>
        <div className={`${card ? "text-lg" : "text-sm"} font-semibold text-slate-900`}>Add your signature</div>
        <div className="text-sm text-slate-500">Upload a picture, draw it, or type your name.</div>
      </div>

      <div role="tablist" className="flex gap-1 p-1 rounded-lg bg-slate-100">
        {tab("upload", "Upload")}
        {tab("draw", "Draw")}
        {tab("type", "Type")}
      </div>

      {mode === "upload" && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); fromFile(e.dataTransfer.files?.[0]); }}
            className={`w-full rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center gap-2 text-center transition-colors ${
              dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50"
            }`}
          >
            <span className="w-11 h-11 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
            </span>
            <span className="text-sm font-semibold text-slate-800">Upload signature image</span>
            <span className="text-xs text-slate-500">Tap to choose<span className="hidden md:inline">, or drag a file here</span> · PNG, JPG or a photo</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ""; }} />
          <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={clearPaper} onChange={(e) => setClearPaper(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600" />
            <span>Remove white paper background <span className="text-slate-400">(best for photos)</span></span>
          </label>
        </>
      )}

      {mode === "draw" && (
        <>
          <div className="relative rounded-xl border border-slate-300 bg-white">
            <canvas ref={pad} onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp}
              className="w-full h-36 touch-none cursor-crosshair rounded-xl" aria-label="Signature drawing pad" />
            {!hasInk && <span className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 pointer-events-none">Sign here with your mouse or finger</span>}
            <div className="absolute left-4 right-4 bottom-7 border-b border-dashed border-slate-300 pointer-events-none" />
          </div>
          <div className="flex items-center justify-between">
            {inkPicker}
            <div className="flex gap-2">
              <button type="button" onClick={clearPad} disabled={!hasInk} className="h-9 px-3 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40">Clear</button>
              <button type="button" onClick={useDrawing} disabled={!hasInk} className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">Use this</button>
            </div>
          </div>
        </>
      )}

      {mode === "type" && (
        <>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" maxLength={60}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="h-20 rounded-xl border border-slate-200 bg-white flex items-center justify-center px-3 overflow-hidden">
            <span style={{ color: ink, fontFamily: `"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive` }} className="text-3xl italic truncate">
              {typed || <span className="text-slate-300 text-base not-italic font-sans">Preview</span>}
            </span>
          </div>
          <div className="flex items-center justify-between">
            {inkPicker}
            <button type="button" onClick={useTyped} disabled={!typed.trim()} className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">Use this</button>
          </div>
        </>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <p className="text-xs text-slate-400">Your signature stays on this device; nothing is uploaded.</p>
    </div>
  );
}
