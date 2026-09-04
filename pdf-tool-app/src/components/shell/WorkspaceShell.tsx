"use client";

import { useApp } from "@/lib/state/app-state";

export function WorkspaceShell() {
  const { activeFormat, isWorkspaceActive, setWorkspaceActive } = useApp();

  if (isWorkspaceActive) return null;

  return (
    <div className="w-full flex-1 flex flex-col items-center text-center max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-300">
      {activeFormat === "pdf" ? (
        <>
          <h2 className="font-display text-4xl mb-4 text-slate-900">PDF Tools</h2>
          <p className="text-slate-500 mb-8 text-lg">
            Everything you need to work with PDFs. Merge, split, extract, rotate, and format securely in your browser.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-display text-4xl mb-4 text-slate-900 capitalize">{activeFormat} Tools</h2>
          <p className="text-slate-500 mb-8 text-lg">
            Support for this format is coming soon to the Layah workspace.
          </p>
        </>
      )}
      <button 
        onClick={() => setWorkspaceActive(true)}
        className="bg-layah-primary text-white px-8 py-3.5 rounded-lg font-medium text-lg hover:bg-blue-600 transition-colors shadow-sm flex items-center gap-2"
      >
        Start working <span>&rarr;</span>
      </button>
    </div>
  );
}
