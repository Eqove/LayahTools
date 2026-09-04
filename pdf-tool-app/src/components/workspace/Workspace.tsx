"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { useApp } from "@/lib/state/app-state";
import { CAPABILITY_REGISTRY } from "@/lib/capabilities/registry";
import { WorkspaceHeader } from "@/components/shell/WorkspaceHeader";
import { CommandBar } from "@/components/shell/CommandBar";
import dynamic from 'next/dynamic';

const PdfViewer = dynamic(
  () => import('@/components/pdf/viewer/PdfViewer').then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <div className="p-8 text-center text-slate-500">Initializing viewer...</div> }
);
import { downloadBytes } from "@/lib/pdf/download";
import {
  addPageNumbers,
  createBlankPdf,
  deletePdfPages,
  extractPdfPages,
  mergePdfFiles,
  rotatePdf,
  splitPdfByRanges,
  watermarkPdf,
} from "@/lib/pdf/operations";
import type { PdfToolId } from "@/lib/pdf/types";

type StudioResult = {
  filename: string;
  bytes: Uint8Array;
};

type FormState = {
  pageRanges: string;
  rotateAngle: string;
  watermarkText: string;
  pageNumberPrefix: string;
  blankTitle: string;
  blankBody: string;
  blankPageCount: string;
  blankWidth: string;
  blankHeight: string;
};

const INITIAL_FORM: FormState = {
  pageRanges: "1-2",
  rotateAngle: "90",
  watermarkText: "CONFIDENTIAL",
  pageNumberPrefix: "",
  blankTitle: "Meeting Notes",
  blankBody: "Action items\nOwner\nDue date",
  blankPageCount: "1",
  blankWidth: "595",
  blankHeight: "842",
};

export function Workspace() {
  const { activeCapabilityId, setActiveCapabilityId, activeFormat, setWorkspaceActive } = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<StudioResult[]>([]);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Default to pdf.merge if none selected
  const activeId = activeCapabilityId || "pdf.merge";
  const capability = CAPABILITY_REGISTRY[activeId];

  // Map capability ID to old PdfToolId for the operations
  const toolIdMap: Record<string, PdfToolId> = {
    "pdf.merge": "merge",
    "pdf.split": "split",
    "pdf.extract": "extract",
    "pdf.delete": "delete",
    "pdf.rotate": "rotate",
    "pdf.watermark": "watermark",
    "pdf.page-numbers": "page-numbers",
    "pdf.blank": "blank",
  };
  const activeTool = toolIdMap[activeId] || "merge";
  const acceptsMultiple = capability?.supportsBatch || false;
  const requiredFileCount = acceptsMultiple ? 2 : 1;

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFiles(nextFiles: FileList | null) {
    if (!nextFiles?.length) return;
    const accepted = [...nextFiles].filter((file) => file.type === "application/pdf");
    setFiles(accepted);
    setResults([]);

    if (accepted.length !== nextFiles.length && activeTool !== "blank") {
      setStatus("Only PDF files are supported in the current V1 tool set.");
      setStatusTone("error");
      return;
    }
    setStatus(`${accepted.length} file(s) ready.`);
    setStatusTone("neutral");
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function ensureFiles() {
    if (activeTool === "blank") return;
    if (files.length < requiredFileCount) {
      throw new Error(
        requiredFileCount > 1
          ? `Select at least ${requiredFileCount} PDF files first.`
          : "Select a PDF file first."
      );
    }
  }

  function runTool() {
    startTransition(async () => {
      try {
        ensureFiles();
        setStatus(`Running ${capability?.name || "tool"}...`);
        setStatusTone("neutral");

        let nextResults: StudioResult[] = [];

        switch (activeTool) {
          case "merge":
            nextResults = await mergePdfFiles(files);
            break;
          case "split":
            nextResults = await splitPdfByRanges(files[0], form.pageRanges);
            break;
          case "extract":
            nextResults = await extractPdfPages(files[0], form.pageRanges);
            break;
          case "delete":
            nextResults = await deletePdfPages(files[0], form.pageRanges);
            break;
          case "rotate":
            nextResults = await rotatePdf(files[0], Number(form.rotateAngle));
            break;
          case "watermark":
            nextResults = await watermarkPdf(files[0], form.watermarkText);
            break;
          case "page-numbers":
            nextResults = await addPageNumbers(files[0], form.pageNumberPrefix);
            break;
          case "blank":
            nextResults = await createBlankPdf({
              pageCount: Number(form.blankPageCount),
              width: Number(form.blankWidth),
              height: Number(form.blankHeight),
              title: form.blankTitle,
              body: form.blankBody,
            });
            break;
          default:
            throw new Error("This capability is not ready yet.");
        }

        setResults(nextResults);
        setStatus(
          nextResults.length === 1
            ? "Your output is ready."
            : `${nextResults.length} outputs generated.`
        );
        setStatusTone("success");
      } catch (error) {
        setResults([]);
        setStatus(error instanceof Error ? error.message : "Something went wrong.");
        setStatusTone("error");
      }
    });
  }

  // Dynamically group capabilities by category from the registry
  const capabilityGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    Object.values(CAPABILITY_REGISTRY).forEach((cap) => {
      if (!groups[cap.category]) {
        groups[cap.category] = [];
      }
      groups[cap.category].push(cap.id);
    });

    // Desired display order for categories
    const categoryOrder = ["organize", "create", "convert", "understand", "secure", "optimize", "edit"];
    
    return Object.keys(groups)
      .sort((a, b) => {
        const indexA = categoryOrder.indexOf(a);
        const indexB = categoryOrder.indexOf(b);
        return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
      })
      .map(category => ({
        title: category,
        items: groups[category]
      }));
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-50 relative">
      <WorkspaceHeader goHome={() => setWorkspaceActive(false)} />
      
      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT: CAPABILITY NAVIGATION */}
        <aside className="w-64 bg-white border-r border-slate-200 overflow-y-auto flex flex-col p-4">
          {capabilityGroups.map((group, idx) => (
            <div key={idx} className="mb-8">
              <h3 className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-3 ml-2">
                {group.title}
              </h3>
              <div className="flex flex-col gap-1">
                {group.items.map((id) => {
                  const cap = CAPABILITY_REGISTRY[id];
                  if (!cap) return null;
                  const isActive = activeId === id;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setActiveCapabilityId(id);
                        setResults([]);
                        setStatus("");
                      }}
                      className={clsx(
                        "text-left px-3 py-2 rounded-md text-sm font-medium transition-colors",
                        isActive 
                          ? "bg-blue-50 text-layah-primary" 
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      {cap.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* CENTER: DOCUMENT CANVAS */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#f0f2f5] relative">
          <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center">
            
            {activeFormat === "pdf" ? (
              <div className="w-full h-full flex flex-col relative">
                {/* Context Header */}
                <div className="border-b border-slate-200 p-5 bg-white flex justify-between items-start shrink-0 rounded-t-xl">
                  <div>
                    <h2 className="text-xl font-display text-slate-900 mb-1">{capability?.name}</h2>
                    <p className="text-sm text-slate-500">{capability?.summary}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={runTool} 
                      disabled={isPending || (!files.length && activeTool !== "blank")}
                      className="bg-layah-primary text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      {isPending ? "Processing..." : "Run Tool"}
                    </button>
                  </div>
                </div>

                {/* Status Banner */}
                {status && (
                  <div className={clsx(
                    "px-6 py-2.5 text-sm font-medium shrink-0",
                    statusTone === "error" ? "bg-red-50 text-red-700 border-b border-red-100" :
                    statusTone === "success" ? "bg-green-50 text-green-700 border-b border-green-100" :
                    "bg-blue-50 text-layah-primary border-b border-blue-100"
                  )}>
                    {status}
                  </div>
                )}

                {/* Configuration Panel Floating Overlay (Only if active tool needs fields) */}
                {(files.length > 0 || activeTool === "blank") && activeTool !== "merge" && (
                  <div className="absolute top-24 right-6 w-80 bg-white/95 backdrop-blur shadow-xl p-5 rounded-xl border border-slate-200 z-20">
                    <h3 className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-wider">Configuration</h3>
                    <ToolFields activeTool={activeTool} form={form} updateForm={updateForm} />
                  </div>
                )}

                {/* Document Surface / Viewer */}
                <div className="flex-1 relative flex flex-col min-h-0 bg-[#e4e7ec] overflow-hidden">
                  
                  {/* File Input (Hidden) */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="application/pdf"
                    multiple={acceptsMultiple}
                    onChange={(event) => handleFiles(event.target.files)}
                  />

                  {/* Empty State / Dropzone */}
                  {!files.length && activeTool !== "blank" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="w-16 h-16 bg-white shadow-sm border border-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-400">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <p className="text-slate-900 font-medium text-lg mb-1">Drop a file here</p>
                      <p className="text-slate-500 text-sm mb-6">or</p>
                      <button onClick={openFilePicker} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm">
                        Choose a file
                      </button>
                    </div>
                  )}

                  {/* PDF Viewer */}
                  {files.length > 0 && activeTool !== "blank" && (
                     <PdfViewer file={files[0]} />
                  )}
                  
                  {/* Blank PDF View Placeholder */}
                  {activeTool === "blank" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div 
                        className="bg-white shadow-md border border-slate-200" 
                        style={{ width: `${form.blankWidth}px`, height: `${form.blankHeight}px`, transform: 'scale(0.7)' }}
                      >
                         <div className="p-12 text-slate-400 text-center font-medium opacity-50">
                            Blank PDF Preview
                         </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center w-full max-w-lg mx-auto py-24 opacity-60">
                <div className="w-16 h-16 bg-white shadow-sm border border-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-6 text-slate-400">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                </div>
                <h2 className="text-3xl font-display text-slate-800 mb-2 capitalize">{activeFormat} Workspace</h2>
                <p className="text-slate-500 mb-4">{activeFormat} tools are coming into this workspace.</p>
              </div>
            )}
            
            {/* Spacing for command bar */}
            <div className="h-24"></div>
          </div>

          {/* Bottom Command Bar */}
          <div className="absolute bottom-6 left-0 right-0 px-4 md:px-8 pointer-events-none z-20">
            <div className="pointer-events-auto w-full">
              <CommandBar />
            </div>
          </div>
        </main>

        {/* RIGHT: FILES & OUTPUTS */}
        <aside className="w-72 bg-white border-l border-slate-200 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Files</h3>
              <button onClick={openFilePicker} className="text-layah-primary hover:text-blue-700 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>

            <div className="flex flex-col gap-3 mb-8">
              {files.length > 0 ? files.map((f, i) => (
                <div key={i} className="bg-slate-50 border border-slate-100 p-3 rounded-lg flex items-start justify-between group">
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-medium text-slate-900 truncate">{f.name}</p>
                    <p className="text-xs text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              )) : (
                <p className="text-sm text-slate-500 text-center py-4">No files loaded</p>
              )}
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Outputs</h3>
            </div>
            
            <div className="flex flex-col gap-3">
              {results.length > 0 ? results.map((res, i) => (
                <div key={i} className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex flex-col gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{res.filename}</p>
                    <p className="text-xs text-blue-600 font-medium">Ready</p>
                  </div>
                  <button onClick={() => downloadBytes(res.bytes, res.filename)} className="w-full text-xs font-medium bg-white border border-blue-200 text-layah-primary py-1.5 rounded hover:bg-blue-100 transition-colors">
                    Download
                  </button>
                </div>
              )) : (
                <p className="text-sm text-slate-500 text-center py-4">No outputs yet</p>
              )}
            </div>

          </div>
        </aside>

      </div>
    </div>
  );
}

// Re-using the exact form logic from pdf-studio.tsx for stability
function ToolFields({
  activeTool,
  form,
  updateForm,
}: {
  activeTool: PdfToolId;
  form: FormState;
  updateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const inputClass = "w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-1";
  const labelClass = "block text-sm font-medium text-slate-700 mb-3";

  if (activeTool === "blank") {
    return (
      <div className="flex flex-col gap-4">
        <label className={labelClass}>
          Title
          <input className={inputClass} value={form.blankTitle} onChange={(e) => updateForm("blankTitle", e.target.value)} />
        </label>
        <label className={labelClass}>
          Body
          <textarea className={inputClass} rows={3} value={form.blankBody} onChange={(e) => updateForm("blankBody", e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            Width
            <input className={inputClass} value={form.blankWidth} onChange={(e) => updateForm("blankWidth", e.target.value)} />
          </label>
          <label className={labelClass}>
            Height
            <input className={inputClass} value={form.blankHeight} onChange={(e) => updateForm("blankHeight", e.target.value)} />
          </label>
        </div>
      </div>
    );
  }

  if (activeTool === "rotate") {
    return (
      <label className={labelClass}>
        Rotation Angle
        <select className={inputClass} value={form.rotateAngle} onChange={(e) => updateForm("rotateAngle", e.target.value)}>
          <option value="90">90 degrees</option>
          <option value="180">180 degrees</option>
          <option value="270">270 degrees</option>
        </select>
      </label>
    );
  }

  if (activeTool === "watermark") {
    return (
      <label className={labelClass}>
        Watermark Text
        <input className={inputClass} value={form.watermarkText} onChange={(e) => updateForm("watermarkText", e.target.value)} />
      </label>
    );
  }

  if (activeTool === "page-numbers") {
    return (
      <label className={labelClass}>
        Number Prefix
        <input className={inputClass} placeholder="e.g. Page" value={form.pageNumberPrefix} onChange={(e) => updateForm("pageNumberPrefix", e.target.value)} />
      </label>
    );
  }

  if (activeTool === "merge") return null;

  const label = activeTool === "split" ? "Page ranges" : activeTool === "extract" ? "Pages to extract" : "Pages to delete";
  const helper = activeTool === "split" ? "Example: 1-2, 3-4 creates multiple PDFs." : "Example: 1, 3-5";

  return (
    <label className={labelClass}>
      {label}
      <input className={inputClass} value={form.pageRanges} onChange={(e) => updateForm("pageRanges", e.target.value)} />
      <span className="text-xs text-slate-500 font-normal mt-1 block">{helper}</span>
    </label>
  );
}
