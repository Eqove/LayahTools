"use client";

import { useApp, FormatContextId } from "@/lib/state/app-state";

const FORMATS: { id: FormatContextId; label: string; available: boolean }[] = [
  { id: "pdf", label: "PDF", available: true },
  { id: "word", label: "Word", available: false },
  { id: "excel", label: "Excel", available: false },
  { id: "ppt", label: "PowerPoint", available: false },
  { id: "images", label: "Images", available: false },
];

export function FormatSwitcher() {
  const { activeFormat, setActiveFormat, setWorkspaceActive } = useApp();

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8 mb-16 border-b border-slate-200 pb-8">
      {FORMATS.map((format) => (
        <button
          key={format.id || "null"}
          onClick={() => {
            if (format.available && format.id) {
              setActiveFormat(format.id);
            }
          }}
          disabled={!format.available}
          title={format.available ? undefined : `${format.label} support is coming soon`}
          className={`relative text-lg md:text-xl font-medium transition-all duration-300 ${
            format.available
              ? activeFormat === format.id
                ? "text-layah-primary border-b-2 border-layah-primary pb-2"
                : "text-slate-500 hover:text-slate-800"
              : "text-slate-300 cursor-not-allowed"
          }`}
        >
          {format.label}
          {!format.available && (
            <span className="absolute -top-2 -right-3 text-[9px] font-semibold uppercase tracking-wider text-slate-400 leading-none">
              soon
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
