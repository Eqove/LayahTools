"use client";

import { useApp } from "@/lib/state/app-state";
import { PdfStudio } from "@/components/pdf-studio";

export function WorkspaceShell() {
  const { activeFormat, isWorkspaceActive, setWorkspaceActive } = useApp();

  return (
    <div className="w-full flex-1">
      {/* Format Introduction */}
      {!isWorkspaceActive && activeFormat === "pdf" && (
        <div className="flex flex-col items-center text-center max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-300">
          <h2 className="font-display text-4xl mb-4 text-slate-900">PDF Tools</h2>
          <p className="text-slate-500 mb-8 text-lg">
            Everything you need to work with PDFs. Merge, split, extract, rotate, and format securely in your browser.
          </p>
          <button 
            onClick={() => setWorkspaceActive(true)}
            className="bg-layah-primary text-white px-8 py-3.5 rounded-lg font-medium text-lg hover:bg-blue-600 transition-colors shadow-sm flex items-center gap-2"
          >
            Start working <span>&rarr;</span>
          </button>
        </div>
      )}

      {/* Actual Workspace Expansion (Using legacy PdfStudio for now) */}
      {isWorkspaceActive && activeFormat === "pdf" && (
        <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          <PdfStudio />
        </div>
      )}

      {/* Placeholders for other formats */}
      {activeFormat !== "pdf" && activeFormat !== null && (
        <div className="flex flex-col items-center text-center max-w-2xl mx-auto py-12 opacity-60">
          <h2 className="font-display text-3xl mb-4 text-slate-700 capitalize">{activeFormat} Tools</h2>
          <p className="text-slate-500 mb-4">Support for this format is coming soon.</p>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-3 py-1.5 rounded-full">In Development</span>
        </div>
      )}
    </div>
  );
}
