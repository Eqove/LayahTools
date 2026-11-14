"use client";

import React, { useState, useEffect } from "react";
import { readPdfMetadata, PdfMetadata } from "@/lib/pdf/metadata";

interface MetadataPanelProps {
  isOpen: boolean;
  file: File;
  onClose: () => void;
}

export function MetadataPanel({ isOpen, file, onClose }: MetadataPanelProps) {
  const [metadata, setMetadata] = useState<PdfMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !file) return;

    let mounted = true;

    Promise.resolve().then(() => {
      if (!mounted) return;
      setLoading(true);
      setError(null);
    });

    readPdfMetadata(file)
      .then((data) => {
        if (mounted) setMetadata(data);
      })
      .catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to read document metadata.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, file]);

  if (!isOpen) return null;

  const copyDetails = () => {
    if (!metadata) return;
    const lines = [
      `File: ${metadata.fileName}`,
      `Size: ${(metadata.fileSizeBytes / 1024 / 1024).toFixed(2)} MB (${metadata.fileSizeBytes} bytes)`,
      `Pages: ${metadata.pageCount}`,
      metadata.title ? `Title: ${metadata.title}` : null,
      metadata.author ? `Author: ${metadata.author}` : null,
      metadata.subject ? `Subject: ${metadata.subject}` : null,
      metadata.keywords ? `Keywords: ${metadata.keywords.join(", ")}` : null,
      metadata.producer ? `Producer: ${metadata.producer}` : null,
      metadata.creator ? `Creator: ${metadata.creator}` : null,
      metadata.creationDate ? `Created: ${metadata.creationDate}` : null,
      metadata.modificationDate ? `Modified: ${metadata.modificationDate}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const fields = [
    { label: "File Name", value: metadata?.fileName },
    {
      label: "File Size",
      value: metadata ? `${(metadata.fileSizeBytes / 1024 / 1024).toFixed(2)} MB` : undefined,
    },
    { label: "Page Count", value: metadata?.pageCount ? `${metadata.pageCount} pages` : undefined },
    { label: "Title", value: metadata?.title || "None specified" },
    { label: "Author", value: metadata?.author || "None specified" },
    { label: "Subject", value: metadata?.subject || "None specified" },
    {
      label: "Keywords",
      value: metadata?.keywords?.length ? metadata.keywords.join(", ") : "None specified",
    },
    { label: "PDF Producer", value: metadata?.producer || "None specified" },
    { label: "Creator / Application", value: metadata?.creator || "None specified" },
    { label: "Created Date", value: metadata?.creationDate || "Unknown" },
    { label: "Modified Date", value: metadata?.modificationDate || "Unknown" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="metadata-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 id="metadata-dialog-title" className="text-xl font-display text-slate-900 font-normal">
              Document Properties
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-sm" title={file.name}>
              {file.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close properties dialog"
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="text-center py-12 text-sm text-slate-500 animate-pulse">
              Reading document properties...
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {error}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {fields.map((f, i) => (
                <div key={i} className="py-2.5 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 text-xs">
                  <span className="font-semibold text-slate-600 sm:w-1/3 shrink-0">
                    {f.label}
                  </span>
                  <span className="text-slate-900 break-words sm:w-2/3 text-left sm:text-right font-mono text-[11px]">
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex justify-between items-center text-xs">
          <button
            type="button"
            onClick={copyDetails}
            disabled={!metadata || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 font-medium"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-700">Copied to clipboard</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                <span>Copy details</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-layah-primary text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
