"use client";

import { useApp, FormatContextId } from "@/lib/state/app-state";

const FORMATS: { id: FormatContextId; label: string }[] = [
  { id: "pdf", label: "PDF" },
  { id: "word", label: "Word" },
  { id: "excel", label: "Excel" },
  { id: "ppt", label: "PowerPoint" },
  { id: "images", label: "Images" },
];

export function FormatSwitcher() {
  const { activeFormat, setActiveFormat, setWorkspaceActive } = useApp();

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8 mb-16 border-b border-slate-200 pb-8">
      {FORMATS.map((format) => (
        <button
          key={format.id || "null"}
          onClick={() => {
            if (format.id === "pdf") {
              setActiveFormat(format.id);
            }
          }}
          className={`text-lg md:text-xl font-medium transition-all duration-300 ${
            activeFormat === format.id 
              ? "text-layah-primary border-b-2 border-layah-primary pb-2" 
              : "text-slate-400 hover:text-slate-600 cursor-not-allowed"
          }`}
        >
          {format.label}
        </button>
      ))}
    </div>
  );
}
