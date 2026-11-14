"use client";

import { useState, useEffect } from "react";
import { useApp, FormatContextId } from "@/lib/state/app-state";
import { ShortcutModal } from "@/components/shell/ShortcutModal";

const FORMATS: { id: FormatContextId; label: string }[] = [
  { id: "pdf", label: "PDF" },
  { id: "word", label: "Word" },
  { id: "excel", label: "Excel" },
  { id: "ppt", label: "PowerPoint" },
  { id: "images", label: "Images" },
];

export function WorkspaceHeader({ goHome }: { goHome: () => void }) {
  const { activeFormat, setActiveFormat } = useApp();
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Global listener for '?' key to open shortcuts modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
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
          <button
            type="button"
            onClick={() => setIsShortcutsOpen(true)}
            title="Keyboard Shortcuts (?)"
            aria-label="Keyboard Shortcuts"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <span>Shortcuts</span>
            <kbd className="hidden sm:inline-block font-mono text-[10px] text-slate-400 border border-slate-200 rounded px-1 py-0.5 bg-white">
              ?
            </kbd>
          </button>
        </div>
      </header>

      <ShortcutModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </>
  );
}
