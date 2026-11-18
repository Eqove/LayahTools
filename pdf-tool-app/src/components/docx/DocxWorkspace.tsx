"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { DocxRejectedFile } from "@/lib/docx/types";
import type { DocxUtilityId } from "./docx-utilities";
import { DocxFileQueue } from "./DocxFileQueue";
import {
  DocxErrorNotice,
  DocxRejectedNotice,
  DocxStatusNotice,
} from "./DocxFeedback";
import { DocxArrowLeftIcon } from "./DocxIcons";
import { DocxUploadArea } from "./DocxUploadArea";
import { DocxUtilityPanel } from "./DocxUtilityPanel";
import { DocxUtilitySelect } from "./DocxUtilitySelect";
import { useDocxQueue } from "./useDocxQueue";
import { useDocxUtility } from "./useDocxUtility";

const plural = (count: number) => (count === 1 ? "" : "s");

export function DocxWorkspace() {
  const { items, validation, error, addFiles, removeItem, moveItem, clearError } =
    useDocxQueue();
  const [notice, setNotice] = useState<string | null>(null);
  const [rejected, setRejected] = useState<DocxRejectedFile[]>([]);
  const [utility, setUtility] = useState<DocxUtilityId>("extract-text");

  const utilityController = useDocxUtility(utility, items, validation);
  const isProcessing = utilityController.isProcessing;
  // Single-file tools read the first queue entry; merge reads the whole queue.
  const activeItemId = utility === "merge" ? null : (items[0]?.id ?? null);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (isProcessing || files.length === 0) return;

      const result = addFiles(files);
      setRejected(result.rejected);

      const parts: string[] = [];
      if (result.added.length > 0) {
        parts.push(
          `${result.added.length} file${plural(result.added.length)} added to the queue.`
        );
      }
      if (result.duplicates > 0) {
        parts.push(
          `${result.duplicates} duplicate${plural(result.duplicates)} skipped.`
        );
      }
      if (result.added.length === 0 && result.rejected.length > 0) {
        parts.push("No files were added.");
      }
      setNotice(parts.join(" ") || null);
    },
    [addFiles, isProcessing]
  );

  const handleRemove = useCallback(
    (id: string) => {
      if (isProcessing) return;
      const removed = removeItem(id);
      if (removed) setNotice(`Removed \u201c${removed.file.name}\u201d.`);
    },
    [isProcessing, removeItem]
  );

  const handleMove = useCallback(
    (id: string, direction: -1 | 1) => {
      if (isProcessing) return;
      const moved = moveItem(id, direction);
      if (moved) {
        setNotice(
          `Moved \u201c${moved.file.name}\u201d ${direction === -1 ? "up" : "down"}.`
        );
      }
    },
    [isProcessing, moveItem]
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fa]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link
              href="/"
              className="rounded-sm text-lg font-bold tracking-tight text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2"
            >
              LayahTools
            </Link>
            <span aria-hidden="true" className="hidden h-5 w-px bg-slate-200 sm:block" />
            <span className="truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              DOCX
            </span>
          </div>

          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2"
          >
            <DocxArrowLeftIcon />
            <span className="hidden sm:inline">Back to LayahTools</span>
            <span className="sm:hidden">Back</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-layah-primary">
            Document workspace
          </p>
          <h1 className="mt-2 font-display text-4xl font-normal tracking-tight text-slate-900 sm:text-5xl">
            DOCX Workspace
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600 sm:text-lg">
            Choose a tool, add Word documents, and work with them entirely in your browser.
          </p>
        </div>

        <div className="mt-8 space-y-8 sm:mt-10 sm:space-y-10">
          <DocxUtilitySelect
            value={utility}
            onChange={setUtility}
            disabled={isProcessing}
          />

          <div>
            <DocxUploadArea
              hasFiles={items.length > 0}
              disabled={isProcessing}
              onFiles={handleFiles}
            />

            <DocxRejectedNotice
              rejected={rejected}
              onDismiss={() => setRejected([])}
            />
            <DocxErrorNotice message={error} onDismiss={clearError} />
            <DocxStatusNotice message={notice} onDismiss={() => setNotice(null)} />

            <DocxFileQueue
              items={items}
              validation={validation}
              onRemove={handleRemove}
              onMove={handleMove}
              disabled={isProcessing}
              activeItemId={activeItemId}
            />
          </div>

          <DocxUtilityPanel
            utility={utility}
            state={utilityController.state}
            readiness={utilityController.readiness}
            itemCount={items.length}
            isProcessing={isProcessing}
            onRun={utilityController.run}
          />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-1 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>DOCX files stay on this device. Nothing is uploaded.</p>
          <p>LayahTools</p>
        </div>
      </footer>
    </div>
  );
}
