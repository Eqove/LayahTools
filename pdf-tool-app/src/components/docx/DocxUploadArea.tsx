"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import clsx from "clsx";
import { DEFAULT_DOCX_LIMITS } from "@/lib/docx/constants";
import { DocxUploadIcon } from "./DocxIcons";

const MAX_FILE_MB = Math.round(DEFAULT_DOCX_LIMITS.maxFileBytes / (1024 * 1024));

interface DocxUploadAreaProps {
  /** True once the queue has at least one file, which changes the prompt copy. */
  hasFiles: boolean;
  /** Set while a processor runs; changing the inputs would invalidate the running run. */
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/**
 * The whole panel is a native button, so the drop zone is reachable and operable by keyboard
 * without relying on drag-and-drop. The hidden input is opened by the button.
 */
export function DocxUploadArea({
  hasFiles,
  disabled = false,
  onFiles,
}: DocxUploadAreaProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintId = useId();
  const [isDragging, setIsDragging] = useState(false);

  const acceptFiles = (list: FileList | null) => {
    if (disabled || !list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  const handleDragEnter = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (disabled) return;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (disabled) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (disabled) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (disabled) return;
    setIsDragging(false);
    acceptFiles(event.dataTransfer.files);
  };

  return (
    <section aria-labelledby="docx-upload-heading">
      <h2 id="docx-upload-heading" className="sr-only">
        Add DOCX files
      </h2>

      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        onChange={(event) => {
          acceptFiles(event.target.files);
          // Allow the same file to be picked again after it has been removed.
          event.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={disabled}
        aria-label={
          disabled
            ? "Upload unavailable while processing"
            : hasFiles
              ? "Add more DOCX files"
              : "Add your first DOCX file"
        }
        aria-describedby={hintId}
        className={clsx(
          "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:py-12",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2",
          isDragging
            ? "border-layah-primary bg-blue-50/70"
            : "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/70",
          disabled &&
            "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70 hover:border-slate-200 hover:bg-slate-50"
        )}
      >
        <span
          className={clsx(
            "mb-1 flex h-12 w-12 items-center justify-center rounded-xl border transition-colors",
            isDragging
              ? "border-layah-primary/30 bg-blue-100 text-layah-primary"
              : "border-slate-200 bg-slate-50 text-slate-500 group-hover:text-slate-700"
          )}
        >
          <DocxUploadIcon className="h-6 w-6" />
        </span>

        <span className="text-base font-medium text-slate-900">
          {disabled
            ? "Processing in progress"
            : isDragging
              ? "Drop DOCX files to add them"
              : hasFiles
                ? "Add more DOCX files"
                : "Add your first DOCX file"}
        </span>

        <span className="text-sm text-slate-500">
          {disabled ? (
            "You can add more files when it finishes."
          ) : isDragging ? (
            "Release to add them to the queue."
          ) : (
            <>
              or{" "}
              <span className="font-medium text-layah-primary group-hover:underline">
                browse your files
              </span>
            </>
          )}
        </span>

        <span id={hintId} className="mt-1 text-xs text-slate-500">
          .docx only &middot; Up to {MAX_FILE_MB} MB per file
        </span>
      </button>
    </section>
  );
}
