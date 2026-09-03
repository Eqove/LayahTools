"use client";

import { useApp } from "@/lib/state/app-state";

export function WorkspaceHeader() {
  const { activeFormat, setWorkspaceActive } = useApp();

  return (
    <header className="w-full h-14 md:h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shrink-0 sticky top-0 z-10">
      {/* Left: Brand */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setWorkspaceActive(false)}
          className="font-display font-medium text-xl tracking-tight text-slate-900 hover:text-layah-primary transition-colors"
        >
          LayahTools
        </button>
      </div>

      {/* Center: Context */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
        <div className="bg-slate-100 text-slate-600 px-3 py-1 rounded-md text-xs font-semibold tracking-widest uppercase">
          {activeFormat === "pdf" ? "PDF Workspace" : `${activeFormat} Workspace`}
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-3">
        <button className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
          Export
        </button>
        <button className="text-sm font-medium bg-slate-900 text-white px-4 py-1.5 rounded-md hover:bg-slate-800 transition-colors">
          Save
        </button>
      </div>
    </header>
  );
}
