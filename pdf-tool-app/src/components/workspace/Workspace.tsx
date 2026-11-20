"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { useApp } from "@/lib/state/app-state";
import { CAPABILITY_REGISTRY } from "@/lib/capabilities/registry";
import { TOOL_GROUPS, TOP_TOOLS } from "@/lib/capabilities/groups";
import { WorkspaceHeader } from "@/components/shell/WorkspaceHeader";
import dynamic from 'next/dynamic';

const PdfViewer = dynamic(
  () => import('@/components/pdf/viewer/PdfViewer').then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <div className="p-8 text-center text-slate-500">Initializing viewer...</div> }
);
import { RedactOverlay } from "@/components/pdf/interactive/RedactOverlay";
import { SignOverlay } from "@/components/pdf/interactive/SignOverlay";
import { SignaturePicker } from "@/components/workspace/SignaturePicker";

const EditorController = dynamic(
  () => import('@/components/pdf/interactive/EditorController').then((mod) => mod.EditorController),
  { ssr: false, loading: () => <div className="p-8 text-center text-slate-500">Initializing editor...</div> }
);

const PageThumbnailSidebar = dynamic(
  () => import('@/components/workspace/PageThumbnailSidebar').then((mod) => mod.PageThumbnailSidebar),
  { ssr: false, loading: () => <div className="w-10 bg-white border-r border-slate-200" /> }
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
  rearrangePdf,
  redactPdf,
  signPdf,
  cropPdf,
} from "@/lib/pdf/operations";
import { isEncryptedPdf, unlockEncryptedPdf } from "@/lib/pdf/password";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { EmptyState } from "@/components/ui/EmptyState";
import { FileSizeWarning } from "@/components/workspace/FileSizeWarning";
import { PasswordDialog } from "@/components/workspace/PasswordDialog";
import { MetadataPanel } from "@/components/workspace/MetadataPanel";
import { compressPdf } from "@/lib/pdf/heavy-operations";
import { useOcrFlow } from "@/components/workspace/useOcrFlow";
import { OcrFlowPanel } from "@/components/workspace/OcrFlowPanel";
import { FormFillPanel } from "@/components/workspace/FormFillPanel";
import { useFormFill } from "@/components/workspace/useFormFill";
import { FlattenPanel } from "@/components/workspace/FlattenPanel";
import { useFlattenForm } from "@/components/workspace/useFlattenForm";
import { pdfToImage, extractPdfText, analyzeDocumentStructure, extractTables } from "@/lib/pdf/intelligence-operations";
import type { PdfToolId } from "@/lib/pdf/types";
import { addFiles, removeFile as dropFile, replaceFile as swapFile, resolveActive, reorderFiles, type WorkspaceFile } from "@/lib/workspace/files";

type StudioResult = {
  filename: string;
  bytes: Uint8Array;
  /** Size of the input this output was made from (for the compression delta). */
  sourceSize?: number;
};



import type { RedactionRect } from "@/components/pdf/interactive/RedactOverlay";
import type { SignaturePlacement } from "@/components/pdf/interactive/SignOverlay";

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
  pageOrder: number[];
  redactions: RedactionRect[];
  signatures: SignaturePlacement[];
  signatureDataUrl: string | null;
  compressionLevel: "low" | "recommended" | "strong";
  imageFormat: "jpeg" | "png";
  cropMarginTop: string;
  cropMarginRight: string;
  cropMarginBottom: string;
  cropMarginLeft: string;
};

const LARGE_FILE_BYTES = 50 * 1024 * 1024;

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
  pageOrder: [],
  redactions: [],
  signatures: [],
  signatureDataUrl: null,
  compressionLevel: "recommended",
  imageFormat: "jpeg",
  cropMarginTop: "20",
  cropMarginRight: "20",
  cropMarginBottom: "20",
  cropMarginLeft: "20",
};

export function Workspace() {
  const { activeCapabilityId, setActiveCapabilityId, setWorkspaceActive } = useApp();
  // Ownership: `items` = the uploaded collection; `activeFileId` = which one single-document tools/viewer use;
  // `results` = accumulated outputs. Tools read these; only explicit user actions remove entries.
  const [items, setItems] = useState<WorkspaceFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const nextId = useRef(1);
  const files = useMemo(() => items.map((i) => i.file), [items]);
  const active = resolveActive(items, activeFileId);
  const activeFile = active?.file as File; // callers guard with files.length / ensureFiles()
  const [results, setResults] = useState<StudioResult[]>([]);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Phase 2 states: Metadata drawer, Password dialog, File size dismissal
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  // Phone layout: Files / outputs / tool options live in a slide-up sheet instead of a side column.
  const [editPagesOpen, setEditPagesOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingPasswordFile, setPendingPasswordFile] = useState<File | null>(null);
  const [dismissedLargeFiles, setDismissedLargeFiles] = useState<Set<string>>(new Set());

  // File panel drag-to-reorder state
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [dragOverFileId, setDragOverFileId] = useState<string | null>(null);

  // No tool chosen yet: drop a file first, then pick what to do with it (the start screen).
  const choosing = !activeCapabilityId;
  const activeId = activeCapabilityId || "pdf.merge";
  // Outputs of the latest run, shown on the page with a download and "do more with this file" next steps.
  const [lastOutputs, setLastOutputs] = useState<StudioResult[] | null>(null);
  useEffect(() => { setLastOutputs(null); }, [activeCapabilityId]);
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
    "pdf.rearrange": "rearrange",
    "pdf.redact": "redact",
    "pdf.sign": "sign",
    "pdf.compress": "compress",
    "pdf.ocr": "ocr",
    "pdf.pdf-to-image": "pdf-to-image",
    "pdf.extract-text": "extract-text",
    "pdf.analyze-structure": "analyze-structure",
    "pdf.extract-tables": "extract-tables",
    "pdf.crop": "crop",
    "pdf.metadata": "metadata",
    "pdf.fill-form": "fill-form",
    "pdf.flatten": "flatten",
    "pdf.edit": "edit",
  };
  const activeTool = toolIdMap[activeId] || "merge";
  // Scanned-PDF flow for the OCR tool: text-layer check, page statuses, OCR on the chosen pages.
  const ocr = useOcrFlow(active?.file ?? null, activeTool === "ocr", setStatus);
  // AcroForm filling: field list, draft values, validation. Writes a new output; the source file is never replaced.
  const formFill = useFormFill(active?.file ?? null, activeTool === "fill-form");
  // Flatten: inspection, irreversibility warning and explicit confirmation before a new flattened copy is written.
  const flatten = useFlattenForm(active?.file ?? null, activeTool === "flatten");
  const acceptsMultiple = capability?.supportsBatch || false;
  const requiredFileCount = acceptsMultiple ? 2 : 1;

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  /** Append (never replace). Re-adding an identical file (name+size+modified time) is skipped; same name with different content is kept. */
  function handleFiles(nextFiles: FileList | null) {
    if (!nextFiles?.length) return;
    const picked = [...nextFiles];
    const r = addFiles(items, picked, () => `f${nextId.current++}`);
    const added = r.added;
    if (added.length) {
      setItems(r.items);
      setActiveFileId(added[added.length - 1].id);

      // Check if any added PDF is encrypted
      for (const item of added) {
        isEncryptedPdf(item.file).then((encrypted) => {
          if (encrypted) setPendingPasswordFile(item.file);
        });
      }
    }

    const notes: string[] = [];
    if (r.nonPdf) notes.push(`${r.nonPdf} non-PDF skipped`);
    if (r.duplicates) notes.push(`${r.duplicates} already added`);
    const oversized = added.filter((a) => a.file.size > LARGE_FILE_BYTES).length;
    if (oversized) notes.push(`${oversized} large file${oversized > 1 ? "s" : ""} (over 50 MB)`);
    setStatus(notes.length ? `${added.length} added, ${notes.join(", ")}` : added.length === 1 ? "1 file added" : `${added.length} files added`);
    setStatusTone(r.nonPdf || oversized ? "error" : "neutral");
  }

  async function handleUnlockPassword(password: string) {
    if (!pendingPasswordFile) return;
    const unlocked = await unlockEncryptedPdf(pendingPasswordFile, password);
    const target = items.find((i) => i.file === pendingPasswordFile);
    if (target) {
      replaceFile(target.id, unlocked);
      setStatus(`Unlocked ${unlocked.name}`);
      setStatusTone("success");
    }
    setPendingPasswordFile(null);
  }

  function removeFile(id: string) {
    setItems((cur) => dropFile(cur, id));
  }

  function handleFileReorder(fromId: string, toId: string | null) {
    setItems((cur) => reorderFiles(cur, fromId, toId));
  }

  function handleMoveUp(index: number) {
    if (index <= 0) return;
    setItems((cur) => reorderFiles(cur, index, index - 1));
  }

  function handleMoveDown(index: number) {
    if (index >= items.length - 1) return;
    setItems((cur) => reorderFiles(cur, index, index + 1));
  }

  /** Edits replace the bytes of an entry but keep its id, position and active state. */
  function replaceFile(id: string, file: File) {
    setItems((cur) => swapFile(cur, id, file));
  }

  /** Next step on a result: add it to Files (the original stays), make it active and open the chosen tool. */
  function continueWith(res: StudioResult, capabilityId: string) {
    const file = new File([res.bytes as BlobPart], res.filename, { type: "application/pdf" });
    const r = addFiles(items, [file], () => `f${nextId.current++}`);
    if (r.added.length) { setItems(r.items); setActiveFileId(r.added[0].id); }
    setActiveCapabilityId(capabilityId);
    setStatus(capabilityId === "pdf.merge" ? `${res.filename} added. Add another PDF to merge it with.` : `Working on ${res.filename}`);
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
        let doneMessage: string | undefined;
        let doneTone: "success" | "error" = "success";

        switch (activeTool) {
          case "merge":
            nextResults = await mergePdfFiles(files);
            break;
          case "split":
            nextResults = await splitPdfByRanges(activeFile, form.pageRanges);
            break;
          case "extract":
            nextResults = await extractPdfPages(activeFile, form.pageRanges);
            break;
          case "delete":
            nextResults = await deletePdfPages(activeFile, form.pageRanges);
            break;
          case "rotate":
            nextResults = await rotatePdf(activeFile, Number(form.rotateAngle));
            break;
          case "watermark":
            nextResults = await watermarkPdf(activeFile, form.watermarkText);
            break;
          case "page-numbers":
            nextResults = await addPageNumbers(activeFile, form.pageNumberPrefix);
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
          case "rearrange":
            nextResults = await rearrangePdf(activeFile, form.pageOrder);
            break;
          case "redact":
            nextResults = await redactPdf(activeFile, form.redactions);
            break;
          case "sign":
            nextResults = await signPdf(activeFile, form.signatures);
            break;
          case "compress":
            nextResults = await compressPdf(activeFile, form.compressionLevel, (msg) => setStatus(msg));
            break;
          case "ocr": {
            // The original stays in FILES untouched; the searchable copy goes to Outputs like any other result.
            const outcome = await ocr.run();
            nextResults = outcome.results;
            doneMessage = outcome.message;
            doneTone = outcome.tone;
            break;
          }
          case "fill-form": {
            const outcome = await formFill.run();
            nextResults = outcome.results;
            doneMessage = outcome.message;
            doneTone = outcome.tone;
            break;
          }
          case "flatten": {
            const outcome = await flatten.run();
            nextResults = outcome.results;
            doneMessage = outcome.message;
            doneTone = outcome.tone;
            break;
          }
          case "pdf-to-image":
            nextResults = await pdfToImage(activeFile, form.imageFormat, 2.0, (msg) => setStatus(msg));
            break;
          case "extract-text":
            nextResults = await extractPdfText(activeFile, (msg) => setStatus(msg));
            break;
          case "analyze-structure":
            nextResults = await analyzeDocumentStructure(activeFile, (msg) => setStatus(msg));
            break;
          case "extract-tables":
            nextResults = await extractTables(activeFile, (msg) => setStatus(msg));
            break;
          case "crop":
            nextResults = await cropPdf(activeFile, {
              top: Number(form.cropMarginTop) || 0,
              right: Number(form.cropMarginRight) || 0,
              bottom: Number(form.cropMarginBottom) || 0,
              left: Number(form.cropMarginLeft) || 0,
            });
            break;
          case "metadata":
            setIsMetadataOpen(true);
            setStatus("Document properties opened.");
            return;
          default:
            throw new Error("This capability is not ready yet.");
        }

        const tagged = nextResults.map((r) => ({ ...r, sourceSize: activeFile?.size }));
        setResults((prev) => [...tagged, ...prev]);
        setLastOutputs(tagged.length ? tagged : null);
        setStatus(
          doneMessage ??
            (nextResults.length === 1
              ? "1 output ready"
              : `${nextResults.length} outputs ready`)
        );
        setStatusTone(doneTone);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Something went wrong.");
        setStatusTone("error");
      }
    });
  }

  // Page thumbnails: desktop side panel and phone overlay share these. Only the one that fits the screen is mounted
  // (a CSS-hidden copy would still load and render every page). null = not known yet (server render): mount neither.
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px)");
    const sync = () => setPhone(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);

  // Page thumbnails: props shared by both.
  const thumbProps = {
    file: activeFile,
    onFileModified: (updated: File) => { if (active) replaceFile(active.id, updated); },
    onExtractOutput: async (extracted: File) => {
      const bytes = new Uint8Array(await extracted.arrayBuffer());
      setResults((prev) => [{ filename: extracted.name, bytes, sourceSize: activeFile?.size }, ...prev]);
      setStatus(`Extracted page output ready: ${extracted.name}`);
      setStatusTone("success");
    },
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 relative">
      <WorkspaceHeader goHome={() => setWorkspaceActive(false)} onSelectTool={() => setStatus("")} />
      
      <div className="flex flex-1 overflow-hidden">
        
        {/* CENTER: DOCUMENT CANVAS */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#f0f2f5] relative">
          <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
            
            {(
              <div className="w-full h-full flex flex-col relative bg-white">
                {/* Compact Context Header */}
                {!choosing && <div className={clsx("h-12 border-b border-slate-200 px-4 md:px-6 bg-white flex justify-between items-center shrink-0", activeTool === "edit" && "md:hidden")}>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-display text-slate-900">{capability?.name}</h2>
                    <p className="text-xs text-slate-500 hidden md:block">{capability?.summary}</p>
                  </div>
                  <div className="flex items-center gap-2 md:gap-4">
                    {status && (
                      <div className={clsx(
                        "hidden md:flex text-xs font-medium items-center gap-1.5",
                        statusTone === "error" ? "text-red-600" :
                        statusTone === "success" ? "text-green-600" :
                        "text-slate-500"
                      )}>
                        <span className="text-[10px]">●</span> {status}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSheetOpen(true)}
                      className="md:hidden px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 text-slate-700 bg-white"
                    >
                      Files &amp; options{items.length + results.length > 0 ? ` (${items.length + results.length})` : ""}
                    </button>
                    {activeTool !== "edit" && (
                      <button 
                        onClick={runTool} 
                        disabled={
                          isPending ||
                          (!files.length && activeTool !== "blank") ||
                          (activeTool === "ocr" && !!ocr.disabledReason) ||
                          (activeTool === "fill-form" && !!formFill.disabledReason) ||
                          (activeTool === "flatten" && !!flatten.disabledReason)
                        }
                        title={
                          activeTool === "ocr"
                            ? ocr.disabledReason ?? undefined
                            : activeTool === "fill-form"
                            ? formFill.disabledReason ?? undefined
                            : activeTool === "flatten"
                            ? flatten.disabledReason ?? undefined
                            : !files.length && activeTool !== "blank"
                            ? "Add a PDF first"
                            : undefined
                        }
                        className="px-5 py-1.5 rounded-md text-sm font-medium transition-colors shadow-sm shrink-0 bg-layah-primary text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isPending ? "Processing..." : "Run Tool"}
                      </button>
                    )}
                  </div>
                </div>}

                {status && (
                  <div className={clsx("md:hidden px-4 py-1.5 text-xs font-medium border-b border-slate-200 shrink-0", statusTone === "error" ? "text-red-600 bg-red-50" : statusTone === "success" ? "text-green-700 bg-green-50" : "text-slate-600 bg-slate-50")} role="status">{status}</div>
                )}

                {/* Document Surface / Viewer */}
                <div className="flex-1 relative flex flex-col min-h-0 bg-[#e4e7ec] overflow-hidden">

                  {/* File Input (Hidden) */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="application/pdf"
                    multiple
                    onChange={(event) => {
                      handleFiles(event.target.files);
                      event.target.value = ""; // allow picking the same file again
                    }}
                  />

                  {/* Large File Warning Banner */}
                  {activeFile && activeFile.size > LARGE_FILE_BYTES && !dismissedLargeFiles.has(activeFile.name) && (
                    <div className="p-3 bg-[#e4e7ec] shrink-0 border-b border-amber-200/50">
                      <FileSizeWarning
                        fileName={activeFile.name}
                        fileSizeBytes={activeFile.size}
                        onDismiss={() => {
                          setDismissedLargeFiles((prev) => new Set([...prev, activeFile.name]));
                        }}
                      />
                    </div>
                  )}

                  <ErrorBoundary fallbackTitle="Document viewer encountered an issue" onReset={() => setStatus("Viewer refreshed.")}>
                    {/* Empty State / Dropzone */}
                    {!files.length && (choosing || activeTool !== "blank") && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6">
                        <EmptyState
                          title="Drop a PDF file here"
                          description={choosing ? "Then choose what to do with it. Your file stays on your device; nothing is uploaded." : "Or browse files from your computer to start editing and organizing."}
                          actionLabel="Choose a file"
                          onAction={openFilePicker}
                        />
                      </div>
                    )}

                    {/* Start screen: the file is here, now pick what to do */}
                    {choosing && files.length > 0 && (
                      <ToolChooser fileName={activeFile.name} count={files.length} onPick={(id) => { setActiveCapabilityId(id); setStatus(""); }} onAddMore={openFilePicker} />
                    )}

                    {/* Edit Tool Integration */}
                    {!choosing && files.length > 0 && activeTool === "edit" && (
                      <div className="flex-1 flex overflow-hidden">
                        {phone === false && editPagesOpen && <div className="flex"><PageThumbnailSidebar {...thumbProps} /></div>}
                        <div className="flex-1 min-w-0 overflow-hidden relative isolate">
                       <EditorController key={active.id} file={activeFile} onFileModified={(f) => replaceFile(active.id, f)} pagesOpen={editPagesOpen} onTogglePages={() => setEditPagesOpen((o) => !o)} />
                          {phone && <PageThumbnailSidebar {...thumbProps} variant="floating" />}
                        </div>
                      </div>
                    )}

                    {/* PDF Viewer with Page Thumbnails Sidebar */}
                    {!choosing && files.length > 0 && activeTool !== "blank" && activeTool !== "edit" && (
                      <div className="flex-1 flex overflow-hidden">
                        {phone === false && <div className="flex"><PageThumbnailSidebar {...thumbProps} /></div>}
                        <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative isolate">
                          {phone && activeTool !== "rearrange" && <PageThumbnailSidebar {...thumbProps} variant="floating" />}
                          <PdfViewer 
                            file={activeFile} 
                            viewMode={activeTool === "rearrange" ? "grid" : "scroll"}
                            pageOrder={activeTool === "rearrange" ? form.pageOrder : undefined}
                            onPageReorder={(order) => updateForm("pageOrder", order)}
                            renderPageOverlay={(pageIndex) => {
                              if (activeTool === "redact") {
                                return <RedactOverlay pageIndex={pageIndex} redactions={form.redactions} onChange={(redactions) => updateForm("redactions", redactions)} />;
                              }
                              if (activeTool === "sign") {
                                return <SignOverlay pageIndex={pageIndex} signatures={form.signatures} onChange={(signatures) => updateForm("signatures", signatures)} activeSignatureDataUrl={form.signatureDataUrl} />;
                              }
                              return null;
                            }}
                          />
                          {/* Sign: ask for the signature right on the document, not only in the side panel */}
                          {activeTool === "sign" && !form.signatureDataUrl && (
                            <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-slate-900/25 backdrop-blur-[2px] overflow-y-auto">
                              <SignaturePicker variant="card" value={null} onChange={(url) => updateForm("signatureDataUrl", url)} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Blank PDF View Placeholder */}
                    {!choosing && activeTool === "blank" && (
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
                  </ErrorBoundary>

                  {/* Result: download right here, then carry on with the same file without uploading again */}
                  {lastOutputs && !choosing && (
                    <ResultCard outputs={lastOutputs} currentTool={activeId} onClose={() => setLastOutputs(null)} onNext={(id) => continueWith(lastOutputs[0], id)} />
                  )}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* RIGHT: FILES & OUTPUTS */}
        <aside className={clsx("bg-white border-slate-200 flex-col shrink-0 fixed inset-x-0 bottom-0 top-12 z-30 md:static md:z-auto md:w-72 md:border-l md:flex", sheetOpen ? "flex" : "hidden")}>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Files</h3>
              <button type="button" onClick={() => setSheetOpen(false)} className="md:hidden ml-auto mr-3 px-3 py-1 rounded-md text-sm font-medium bg-layah-primary text-white">Done</button>
              <button onClick={openFilePicker} className="text-layah-primary hover:text-blue-700 p-1" aria-label="Add files">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>

            <div className="flex flex-col gap-1 mb-8">
              {items.length > 0 ? items.map((it, idx) => (
                <div
                  key={it.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragFileId(it.id); }}
                  onDragEnd={() => { setDragFileId(null); setDragOverFileId(null); }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverFileId(it.id); }}
                  onDragLeave={() => setDragOverFileId(null)}
                  onDrop={(e) => { e.preventDefault(); if (dragFileId && dragFileId !== it.id) handleFileReorder(dragFileId, it.id); setDragFileId(null); setDragOverFileId(null); }}
                  onClick={() => setActiveFileId(it.id)}
                  className={clsx(
                    "border p-2.5 rounded-lg flex items-center justify-between group cursor-pointer transition-all gap-2",
                    dragOverFileId === it.id && dragFileId !== it.id ? "border-blue-400 bg-blue-50 shadow-sm" : "",
                    dragFileId === it.id ? "opacity-40" : "",
                    it.id === active?.id && dragFileId !== it.id ? "bg-blue-50 border-blue-200" : !dragOverFileId || dragOverFileId !== it.id ? "bg-slate-50 border-slate-100 hover:border-slate-200" : ""
                  )}
                  aria-current={it.id === active?.id}
                >
                  {/* Order badge & Drag handle */}
                  <div className="flex items-center gap-1.5 shrink-0 select-none">
                    <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-200/80 rounded px-1.5 py-0.5" title={`File #${idx + 1}`}>
                      #{idx + 1}
                    </span>
                    <span className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing p-0.5" title="Drag to reorder">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
                      </svg>
                    </span>
                  </div>

                  {/* File name & size */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-slate-900 truncate" title={it.file.name}>{it.file.name}</p>
                      <button
                        type="button"
                        title="View document properties"
                        aria-label={`View properties for ${it.file.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFileId(it.id);
                          setIsMetadataOpen(true);
                        }}
                        className="text-slate-400 hover:text-layah-primary p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      {(it.file.size / 1024 / 1024).toFixed(2)} MB{it.id === active?.id && items.length > 1 ? " · active" : ""}
                    </p>
                  </div>

                  {/* Actions: Move Up, Move Down, Remove */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      aria-label={`Move ${it.file.name} up`}
                      title="Move up"
                      disabled={idx === 0}
                      onClick={(e) => { e.stopPropagation(); handleMoveUp(idx); }}
                      className="text-slate-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-slate-400 p-1 rounded hover:bg-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${it.file.name} down`}
                      title="Move down"
                      disabled={idx === items.length - 1}
                      onClick={(e) => { e.stopPropagation(); handleMoveDown(idx); }}
                      className="text-slate-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-slate-400 p-1 rounded hover:bg-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${it.file.name}`}
                      title="Remove file"
                      onClick={(e) => { e.stopPropagation(); removeFile(it.id); }}
                      className="text-slate-400 hover:text-red-500 opacity-60 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-white ml-0.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )) : (
                <EmptyState
                  title="No files loaded"
                  description="Add PDF files to begin."
                  actionLabel="Choose files"
                  onAction={openFilePicker}
                  className="py-6"
                />
              )}
              {/* Drop zone at end (move to last position) */}
              {dragFileId && (
                <div
                  className="h-8 rounded-lg border-2 border-dashed border-blue-300 flex items-center justify-center text-xs text-blue-400"
                  onDragOver={(e) => { e.preventDefault(); setDragOverFileId("__end__"); }}
                  onDragLeave={() => setDragOverFileId(null)}
                  onDrop={(e) => { e.preventDefault(); if (dragFileId) handleFileReorder(dragFileId, null); setDragFileId(null); setDragOverFileId(null); }}
                >
                  Move to end
                </div>
              )}
            </div>

            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Outputs</h3>
              {results.length > 0 && <button onClick={() => setResults([])} className="text-xs text-slate-500 hover:text-slate-900">Clear</button>}
            </div>
            
            <div className="flex flex-col gap-3">
              {results.length > 0 ? results.map((res, i) => {
                const originalSize = res.sourceSize || 0;
                const newSize = res.bytes.length;
                const reduction = originalSize > 0 ? ((originalSize - newSize) / originalSize * 100).toFixed(1) : "0";
                const isCompressed = activeTool === "compress" && originalSize > 0;

                return (
                <div key={i} className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex flex-col gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate" title={res.filename}>{res.filename}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-blue-600 font-medium">Ready ({(newSize / 1024 / 1024).toFixed(2)} MB)</p>
                      {isCompressed && Number(reduction) > 0 && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">
                          -{reduction}%
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => downloadBytes(res.bytes, res.filename)} className="w-full text-xs font-medium bg-white border border-blue-200 text-layah-primary py-1.5 rounded hover:bg-blue-100 transition-colors">
                    Download
                  </button>
                </div>
                );
              }) : (
                <p className="text-sm text-slate-500 text-center py-4">No outputs yet</p>
              )}
            </div>

            {/* CONFIGURATION SECTION */}
            {!choosing && (files.length > 0 || activeTool === "blank") && activeTool !== "merge" && activeTool !== "edit" && (
              <div className="mt-8 border-t border-slate-100 pt-6">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Configuration</h3>
                </div>
                <div className="flex flex-col gap-4">
                  {activeTool === "ocr" ? (
                    <OcrFlowPanel flow={ocr} />
                  ) : activeTool === "fill-form" ? (
                    <FormFillPanel flow={formFill} />
                  ) : activeTool === "flatten" ? (
                    <FlattenPanel flow={flatten} />
                  ) : (
                    <ToolFields
                      activeTool={activeTool}
                      form={form}
                      updateForm={updateForm}
                      onOpenMetadata={() => setIsMetadataOpen(true)}
                    />
                  )}
                </div>
              </div>
            )}

          </div>
        </aside>

      </div>

      <PasswordDialog
        isOpen={!!pendingPasswordFile}
        fileName={pendingPasswordFile?.name || ""}
        onUnlock={handleUnlockPassword}
        onCancel={() => setPendingPasswordFile(null)}
      />

      {activeFile && (
        <MetadataPanel
          isOpen={isMetadataOpen}
          file={activeFile}
          onClose={() => setIsMetadataOpen(false)}
        />
      )}
    </div>
  );
}

const NEXT_STEPS: { id: string; label: string }[] = [
  { id: "pdf.edit", label: "Edit" },
  { id: "pdf.sign", label: "Sign" },
  { id: "pdf.compress", label: "Compress" },
  { id: "pdf.merge", label: "Merge with another" },
];

/** Shown over the page after a run: download, and the most likely next steps on the new file. */
function ResultCard({ outputs, currentTool, onClose, onNext }: {
  outputs: StudioResult[]; currentTool: string; onClose: () => void; onNext: (capabilityId: string) => void;
}) {
  const one = outputs.length === 1 ? outputs[0] : null;
  const isPdf = !!one && /\.pdf$/i.test(one.filename);
  const mb = (n: number) => (n / 1024 / 1024).toFixed(2) + " MB";
  return (
    <div role="status" className="absolute bottom-4 inset-x-3 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[34rem] z-[65] bg-white border border-green-200 rounded-xl shadow-xl p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm" aria-hidden>✓</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate" title={one?.filename}>{one ? one.filename : `${outputs.length} files ready`}</p>
          <p className="text-xs text-slate-500">{one ? `Ready · ${mb(one.bytes.length)}${one.sourceSize && one.bytes.length < one.sourceSize ? ` (was ${mb(one.sourceSize)})` : ""}` : "Each one is also listed under Outputs."}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 p-1 -m-1">✕</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => outputs.forEach((o) => downloadBytes(o.bytes, o.filename))}
          className="px-4 py-2 rounded-md text-sm font-semibold bg-layah-primary text-white hover:bg-blue-600">
          {one ? "Download" : `Download all (${outputs.length})`}
        </button>
        {isPdf && <>
          <span className="text-xs text-slate-500 ml-1">Do more with this file:</span>
          {NEXT_STEPS.filter((n) => n.id !== currentTool).map((n) => (
            <button key={n.id} type="button" onClick={() => onNext(n.id)}
              className="px-3 py-2 rounded-md text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50">{n.label}</button>
          ))}
        </>}
      </div>
    </div>
  );
}

/** Start screen once a file is in: six big, common actions; everything else under "More tools". */
function ToolChooser({ fileName, count, onPick, onAddMore }: { fileName: string; count: number; onPick: (id: string) => void; onAddMore: () => void }) {
  const [more, setMore] = useState(false);
  const top = new Set(TOP_TOOLS.map((t) => t.id));
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 md:py-10">
        <p className="text-xs text-slate-500 truncate">{count > 1 ? `${count} files · working on ` : ""}<span className="font-medium text-slate-700">{fileName}</span></p>
        <h2 className="text-2xl md:text-3xl font-display text-slate-900 mt-1 mb-5">What do you want to do?</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {TOP_TOOLS.map((t) => (
            <button key={t.id} type="button" onClick={() => onPick(t.id)}
              className="text-left bg-white border border-slate-200 rounded-xl p-4 min-h-[7rem] hover:border-blue-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
              <svg className="w-7 h-7 text-layah-primary mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={t.icon} /></svg>
              <span className="block text-base font-semibold text-slate-900">{t.label}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{t.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
            className="px-4 py-2 rounded-md text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            {more ? "Fewer tools" : "More tools"}
          </button>
          <button type="button" onClick={onAddMore} className="px-4 py-2 rounded-md text-sm font-medium text-layah-primary hover:bg-blue-50">+ Add more PDFs</button>
        </div>
        {more && (
          <div className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-4">
            {TOOL_GROUPS.map((g) => {
              const rest = g.items.filter((c) => !top.has(c.id));
              if (!rest.length) return null;
              return (
                <div key={g.id}>
                  <div className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">{g.title}</div>
                  {rest.map((c) => (
                    <button key={c.id} type="button" onClick={() => onPick(c.id)} className="w-full text-left px-2 py-2 rounded-md hover:bg-white">
                      <span className="block text-sm font-medium text-slate-800">{c.name}</span>
                      <span className="block text-xs text-slate-500">{c.summary}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-6 text-xs text-slate-500">🔒 Everything happens on your device. Your files are never uploaded.</p>
      </div>
    </div>
  );
}

// Form logic carried over from the original studio UI
function ToolFields({
  activeTool,
  form,
  updateForm,
  onOpenMetadata,
}: {
  activeTool: PdfToolId;
  form: FormState;
  updateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onOpenMetadata?: () => void;
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

  if (activeTool === "merge") {
    return (
      <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 p-3 rounded-md">
        <strong className="block mb-1">File order determines merge order.</strong>
        Drag the files in the Files panel (right sidebar) to set the order before running.
      </div>
    );
  }

  if (activeTool === "rearrange") {
    return (
      <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 p-3 rounded-md">
        Drag and drop the page thumbnails in the viewer to reorder them.
      </div>
    );
  }

  if (activeTool === "redact") {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 p-3 rounded-md">
          Drag directly on the document pages in the viewer to draw redaction regions.
        </div>
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-md leading-relaxed">
          <strong>Security Notice:</strong> Visual cover is not secure redaction. Black boxes overlay the visual layer; underlying streams must be sanitized for sensitive legal documents.
        </div>
      </div>
    );
  }

  if (activeTool === "sign") {
    return (
      <SignaturePicker
        value={form.signatureDataUrl}
        onChange={(url) => updateForm("signatureDataUrl", url)}
        placedCount={form.signatures.length}
        onClearPlaced={() => updateForm("signatures", [])}
      />
    );
  }

  if (activeTool === "compress") {
    return (
      <div className="flex flex-col gap-3">
        <label className={labelClass}>
          Compression Level
          <select className={inputClass} value={form.compressionLevel} onChange={(e) => updateForm("compressionLevel", e.target.value as any)}>
            <option value="low">Low (High Quality)</option>
            <option value="recommended">Recommended (Good Balance)</option>
            <option value="strong">Strong (Smallest Size)</option>
          </select>
        </label>
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 p-3 rounded-md">
          Note: V1 Compression attempts structural reduction via pdf-lib. True image downsampling requires backend processing.
        </div>
      </div>
    );
  }

  if (activeTool === "pdf-to-image") {
    return (
      <label className={labelClass}>
        Image Format
        <select className={inputClass} value={form.imageFormat} onChange={(e) => updateForm("imageFormat", e.target.value as any)}>
          <option value="jpeg">JPEG (Smaller file size)</option>
          <option value="png">PNG (Lossless quality)</option>
        </select>
      </label>
    );
  }

  if (activeTool === "extract-text") {
    return (
      <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 p-3 rounded-md">
        Extracts structured text with precise coordinate bounding boxes and page associations. Outputs JSON.
      </div>
    );
  }

  if (activeTool === "analyze-structure") {
    return (
      <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 p-3 rounded-md">
        Analyzes the document's structure, detecting headings and structural blocks. Outputs JSON.
      </div>
    );
  }

  if (activeTool === "extract-tables") {
    return (
      <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 p-3 rounded-md">
        Uses local heuristics to detect tabular data (rows and columns). Outputs structured JSON.
      </div>
    );
  }

  if (activeTool === "crop") {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 p-2.5 rounded-md leading-relaxed">
          Specify margin to trim from each edge (in points, 72 pt = 1 inch). PDF bottom-left coordinate system is applied deterministically.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Top (pt)
            <input type="number" min="0" className={inputClass} value={form.cropMarginTop} onChange={(e) => updateForm("cropMarginTop", e.target.value)} />
          </label>
          <label className={labelClass}>
            Bottom (pt)
            <input type="number" min="0" className={inputClass} value={form.cropMarginBottom} onChange={(e) => updateForm("cropMarginBottom", e.target.value)} />
          </label>
          <label className={labelClass}>
            Left (pt)
            <input type="number" min="0" className={inputClass} value={form.cropMarginLeft} onChange={(e) => updateForm("cropMarginLeft", e.target.value)} />
          </label>
          <label className={labelClass}>
            Right (pt)
            <input type="number" min="0" className={inputClass} value={form.cropMarginRight} onChange={(e) => updateForm("cropMarginRight", e.target.value)} />
          </label>
        </div>
      </div>
    );
  }

  if (activeTool === "metadata") {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 p-2.5 rounded-md leading-relaxed">
          Inspect document properties, title, author, creation date, producer, page count, and file statistics.
        </div>
        <button
          type="button"
          onClick={() => onOpenMetadata?.()}
          className="w-full py-2 bg-layah-primary text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Inspect Properties
        </button>
      </div>
    );
  }

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
