"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";

import styles from "@/components/pdf-studio.module.css";
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
import { TOOL_CONFIG } from "@/lib/pdf/tool-config";
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

export function PdfStudio() {
  const [activeTool, setActiveTool] = useState<PdfToolId>("merge");
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<StudioResult[]>([]);
  const [status, setStatus] = useState("Upload files and run a tool. Everything stays in your browser session.");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const tool = useMemo(
    () => TOOL_CONFIG.find((item) => item.id === activeTool) ?? TOOL_CONFIG[0],
    [activeTool],
  );

  const requiredFileCount = tool.acceptsMultiple ? 2 : 1;

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function resetWorkspace() {
    setFiles([]);
    setResults([]);
    setStatus("Workspace cleared. Drop in the next rush job when you are ready.");
    setStatusTone("neutral");
  }

  function handleFiles(nextFiles: FileList | null) {
    if (!nextFiles?.length) {
      return;
    }

    const accepted = [...nextFiles].filter((file) => file.type === "application/pdf");
    setFiles(accepted);
    setResults([]);

    if (accepted.length !== nextFiles.length && activeTool !== "blank") {
      setStatus("Only PDF files are supported in the current V1 tool set.");
      setStatusTone("error");
      return;
    }

    setStatus(`${accepted.length} file${accepted.length === 1 ? "" : "s"} ready for ${tool.name.toLowerCase()}.`);
    setStatusTone("neutral");
  }

  function handleToolChange(toolId: PdfToolId) {
    setActiveTool(toolId);
    setResults([]);
    setStatus(`Switched to ${TOOL_CONFIG.find((item) => item.id === toolId)?.name}.`);
    setStatusTone("neutral");
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function ensureFiles() {
    if (activeTool === "blank") {
      return;
    }

    if (files.length < requiredFileCount) {
      throw new Error(
        requiredFileCount > 1
          ? `Select at least ${requiredFileCount} PDF files first.`
          : "Select a PDF file first.",
      );
    }
  }

  function runTool() {
    startTransition(async () => {
      try {
        ensureFiles();
        setStatus(`Running ${tool.name.toLowerCase()}...`);
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
            throw new Error("This tool is not ready yet.");
        }

        setResults(nextResults);
        setStatus(
          nextResults.length === 1
            ? "Your PDF is ready. Download it below."
            : `${nextResults.length} PDF files are ready. Download the pieces you need.`,
        );
        setStatusTone("success");
      } catch (error) {
        setResults([]);
        setStatus(error instanceof Error ? error.message : "Something went wrong while processing the PDF.");
        setStatusTone("error");
      }
    });
  }

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>FlashPDF V1 Build</span>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <h1>Quick PDF fixes for deadline mode.</h1>
            <p>
              This first build focuses on the urgent jobs people scramble for:
              merge, split, trim, rotate, watermark, paginate, and create a clean PDF from scratch.
            </p>
          </div>
          <div className={styles.heroStats}>
            <div className={styles.statCard}>
              <span className={styles.statValue}>Browser-first</span>
              <span className={styles.statLabel}>No upload backend required for the current tool set</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>8 live tools</span>
              <span className={styles.statLabel}>Focused on practical, last-minute document work</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>Extensible core</span>
              <span className={styles.statLabel}>Structured to add editing, signing, and forms next</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.rail}>
          <h2 className={styles.sectionTitle}>Toolbox</h2>
          <p className={styles.sectionLead}>
            Choose the job, drop the file, and export the result without leaving the page.
          </p>

          <div className={styles.toolList}>
            {TOOL_CONFIG.map((item) => (
              <button
                key={item.id}
                type="button"
                className={clsx(styles.toolButton, item.id === activeTool && styles.toolButtonActive)}
                onClick={() => handleToolChange(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.panel}>
          <div className={styles.panelTop}>
            <div>
              <h2 className={styles.sectionTitle}>{tool.name}</h2>
              <p className={styles.sectionLead}>{tool.summary}</p>
            </div>
            <span className={styles.badge}>
              {activeTool === "blank"
                ? "No source file required"
                : tool.acceptsMultiple
                  ? "Multiple PDFs supported"
                  : "Single PDF flow"}
            </span>
          </div>

          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.dropzone}>
                <div>
                  <strong>
                    {activeTool === "blank"
                      ? "Blank PDF mode is ready."
                      : "Drop PDF files here or use the picker."}
                  </strong>
                  <p>
                    {activeTool === "blank"
                      ? "You can generate a fresh PDF without uploading anything."
                      : tool.acceptsMultiple
                        ? "Add two or more PDFs for combination workflows."
                        : "Add a single PDF to edit pages or apply finishing touches."}
                  </p>
                  {activeTool !== "blank" ? (
                    <div className={styles.inlineActions}>
                      <button type="button" className={styles.button} onClick={openFilePicker}>
                        Choose PDFs
                      </button>
                      <button type="button" className={styles.buttonGhost} onClick={resetWorkspace}>
                        Clear Files
                      </button>
                    </div>
                  ) : (
                    <div className={styles.inlineActions}>
                      <button type="button" className={styles.buttonGhost} onClick={resetWorkspace}>
                        Reset Outputs
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <input
                ref={fileInputRef}
                className={styles.fileInput}
                type="file"
                accept="application/pdf"
                multiple={tool.acceptsMultiple}
                onChange={(event) => handleFiles(event.target.files)}
              />

              {activeTool !== "blank" ? (
                <div className={styles.metaList}>
                  {files.length ? (
                    files.map((file) => (
                      <div key={`${file.name}-${file.size}`} className={styles.metaItem}>
                        <div>
                          <div className={styles.metaName}>{file.name}</div>
                          <div className={styles.metaHint}>
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </div>
                        </div>
                        <div className={styles.metaHint}>PDF</div>
                      </div>
                    ))
                  ) : (
                    <div className={styles.metaItem}>
                      <div>
                        <div className={styles.metaName}>No files loaded yet</div>
                        <div className={styles.metaHint}>Pick a tool and add a PDF to begin.</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <ToolFields activeTool={activeTool} form={form} updateForm={updateForm} />

              <div className={styles.inlineActions}>
                <button type="button" className={styles.button} onClick={runTool} disabled={isPending}>
                  {isPending ? "Processing..." : tool.primaryLabel}
                </button>
              </div>

              <div
                className={clsx(
                  styles.status,
                  statusTone === "error" && styles.statusError,
                  statusTone === "success" && styles.statusSuccess,
                )}
              >
                {status}
              </div>
            </div>

            <div className={styles.card}>
              <h3 className={styles.sectionTitle}>Results</h3>
              <p className={styles.sectionLead}>
                Every completed output appears here immediately with one-click download.
              </p>

              <div className={styles.metaList}>
                {results.length ? (
                  results.map((result) => (
                    <div key={result.filename} className={styles.metaItem}>
                      <div>
                        <div className={styles.metaName}>{result.filename}</div>
                        <div className={styles.metaHint}>Ready to download</div>
                      </div>
                      <button
                        type="button"
                        className={styles.buttonGhost}
                        onClick={() => downloadBytes(result.bytes, result.filename)}
                      >
                        Download
                      </button>
                    </div>
                  ))
                ) : (
                  <div className={styles.metaItem}>
                    <div>
                      <div className={styles.metaName}>No exports yet</div>
                      <div className={styles.metaHint}>Run the selected tool to generate PDFs.</div>
                    </div>
                  </div>
                )}
              </div>

              <ul className={styles.quickList}>
                <li>
                  <strong>Next priority</strong>
                  Text editing, signatures, and form filling can be added on top of this shared workspace.
                </li>
                <li>
                  <strong>Current limitation</strong>
                  This first build processes standard PDFs client-side and does not yet render live page previews.
                </li>
                <li>
                  <strong>Why this matters</strong>
                  The processing layer is already reusable, so new tools do not require a backend rewrite.
                </li>
              </ul>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function ToolFields({
  activeTool,
  form,
  updateForm,
}: {
  activeTool: PdfToolId;
  form: FormState;
  updateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  if (activeTool === "blank") {
    return (
      <div className={styles.fieldGrid}>
        <label className={styles.fieldLabel}>
          Title
          <input value={form.blankTitle} onChange={(event) => updateForm("blankTitle", event.target.value)} />
        </label>
        <label className={styles.fieldLabel}>
          Body
          <textarea value={form.blankBody} onChange={(event) => updateForm("blankBody", event.target.value)} />
        </label>
        <label className={styles.fieldLabel}>
          Page Count
          <input
            type="number"
            min="1"
            max="25"
            value={form.blankPageCount}
            onChange={(event) => updateForm("blankPageCount", event.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          Page Width
          <input value={form.blankWidth} onChange={(event) => updateForm("blankWidth", event.target.value)} />
        </label>
        <label className={styles.fieldLabel}>
          Page Height
          <input value={form.blankHeight} onChange={(event) => updateForm("blankHeight", event.target.value)} />
        </label>
      </div>
    );
  }

  if (activeTool === "rotate") {
    return (
      <div className={styles.fieldGrid}>
        <label className={styles.fieldLabel}>
          Rotation Angle
          <select value={form.rotateAngle} onChange={(event) => updateForm("rotateAngle", event.target.value)}>
            <option value="90">90 degrees</option>
            <option value="180">180 degrees</option>
            <option value="270">270 degrees</option>
          </select>
        </label>
      </div>
    );
  }

  if (activeTool === "watermark") {
    return (
      <div className={styles.fieldGrid}>
        <label className={styles.fieldLabel}>
          Watermark Text
          <input
            value={form.watermarkText}
            onChange={(event) => updateForm("watermarkText", event.target.value)}
          />
        </label>
      </div>
    );
  }

  if (activeTool === "page-numbers") {
    return (
      <div className={styles.fieldGrid}>
        <label className={styles.fieldLabel}>
          Number Prefix
          <input
            value={form.pageNumberPrefix}
            onChange={(event) => updateForm("pageNumberPrefix", event.target.value)}
            placeholder="Optional, for example Section"
          />
        </label>
      </div>
    );
  }

  if (activeTool === "merge") {
    return null;
  }

  const label =
    activeTool === "split"
      ? "Page ranges"
      : activeTool === "extract"
        ? "Pages to extract"
        : "Pages to delete";

  const helper =
    activeTool === "split"
      ? "Example: 1-2, 3-4, 5-7 creates multiple output PDFs."
      : "Example: 1, 3-5";

  return (
    <div className={styles.fieldGrid}>
      <label className={styles.fieldLabel}>
        {label}
        <input value={form.pageRanges} onChange={(event) => updateForm("pageRanges", event.target.value)} />
      </label>
      <div className={styles.metaHint}>{helper}</div>
    </div>
  );
}
