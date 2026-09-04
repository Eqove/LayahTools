"use client";

import { useApp, FormatContextId } from "@/lib/state/app-state";

const FORMATS: { id: FormatContextId; label: string }[] = [
  { id: "pdf", label: "PDF" },
  { id: "word", label: "Word" },
  { id: "excel", label: "Excel" },
  { id: "ppt", label: "PowerPoint" },
  { id: "images", label: "Images" },
];

export function WorkspaceHeader({ goHome }: { goHome: () => void }) {
  const { activeFormat, setActiveFormat } = useApp();

  return (
    <header className="w-full h-14 md:h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shrink-0 sticky top-0 z-10">
      {/* Left: Brand */}
      <div className="flex flex-1 items-center gap-4">
        <button 
          onClick={goHome}
          className="font-sans font-bold text-xl tracking-tight text-slate-900 hover:text-layah-primary transition-colors"
        >
          LayahTools
        </button>
      </div>

      {/* Center: Context Switcher */}
      <div className="flex items-center gap-6 md:gap-8 hidden md:flex">
        {FORMATS.map((format) => (
          <button
            key={format.id || "null"}
            onClick={() => setActiveFormat(format.id)}
            className={`text-sm font-medium transition-all duration-200 ${
              activeFormat === format.id 
                ? "text-layah-primary border-b-2 border-layah-primary py-1" 
                : "text-slate-400 hover:text-slate-600 py-1"
            }`}
          >
            {format.label}
          </button>
        ))}
      </div>

      {/* Right: Controls */}
      <div className="flex flex-1 justify-end items-center gap-3">
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
