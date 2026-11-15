"use client";

import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { useApp } from "@/lib/state/app-state";
import { CAPABILITY_REGISTRY } from "@/lib/capabilities/registry";
import { ShortcutModal } from "@/components/shell/ShortcutModal";

const GROUPS = [
  { id: "organize", title: "Organize pages" },
  { id: "create", title: "Create & edit" },
  { id: "secure", title: "Secure" },
  { id: "understand", title: "Understand & extract" },
  { id: "convert", title: "Convert" },
]
  .map((g) => ({ ...g, items: Object.values(CAPABILITY_REGISTRY).filter((c) => c.category === g.id) }))
  .filter((g) => g.items.length > 0);

export function WorkspaceHeader({ goHome, onSelectTool }: { goHome: () => void; onSelectTool?: () => void }) {
  const { activeCapabilityId, setActiveCapabilityId } = useApp();
  const activeId = activeCapabilityId || "pdf.merge";
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Close the open tool menu on outside click or Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => { if (!navRef.current?.contains(e.target as Node)) setOpenMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [openMenu]);

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
      <header className="w-full h-12 bg-white border-b border-slate-200 flex items-center justify-between px-3 md:px-6 shrink-0 sticky top-0 z-40">
        {/* Left: Brand */}
        <div className="flex flex-1 items-center gap-4">
          <button 
            onClick={goHome}
            className="font-sans font-bold text-xl tracking-tight text-slate-900 hover:text-layah-primary transition-colors"
          >
            LayahTools
          </button>
          <span className="hidden md:block text-sm font-medium text-layah-primary border-b-2 border-layah-primary py-1">PDF</span>
          <div ref={navRef} className="flex items-center">
          <nav aria-label="PDF tools" className="hidden md:flex items-center gap-1 ml-2">
            {GROUPS.map((g) => {
              const open = openMenu === g.id;
              const hasActive = CAPABILITY_REGISTRY[activeId]?.category === g.id;
              return (
                <div key={g.id} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setOpenMenu(open ? null : g.id)}
                    className={clsx(
                      "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                      hasActive || open ? "text-layah-primary bg-blue-50" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    {g.title}
                    <svg className={clsx("w-3 h-3 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {open && (
                    <div role="menu" className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                      {g.items.map((cap) => (
                        <button
                          key={cap.id}
                          role="menuitem"
                          title={cap.summary}
                          onClick={() => { setActiveCapabilityId(cap.id); onSelectTool?.(); setOpenMenu(null); }}
                          className={clsx(
                            "w-full text-left px-3 py-1.5 text-sm",
                            cap.id === activeId ? "bg-blue-50 text-layah-primary font-medium" : "text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          {cap.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          {/* Phone: one Tools button opens a full-width list of every group */}
          <div className="md:hidden">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "mobile"}
              onClick={() => setOpenMenu(openMenu === "mobile" ? null : "mobile")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium text-layah-primary bg-blue-50"
            >
              Tools
              <svg className={clsx("w-3 h-3 transition-transform", openMenu === "mobile" && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {openMenu === "mobile" && (
              <div role="menu" className="fixed inset-x-0 top-12 bottom-0 bg-white overflow-y-auto p-3 border-t border-slate-200">
                {GROUPS.map((g) => (
                  <div key={g.id} className="mb-3">
                    <div className="px-2 py-1 text-xs font-bold tracking-widest uppercase text-slate-400">{g.title}</div>
                    {g.items.map((cap) => (
                      <button
                        key={cap.id}
                        role="menuitem"
                        onClick={() => { setActiveCapabilityId(cap.id); onSelectTool?.(); setOpenMenu(null); }}
                        className={clsx("w-full text-left px-3 py-2.5 rounded-md text-base", cap.id === activeId ? "bg-blue-50 text-layah-primary font-medium" : "text-slate-700")}
                      >
                        {cap.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
          <span className="hidden lg:block ml-1 pl-4 border-l border-slate-200 text-sm font-semibold text-slate-900 truncate" aria-live="polite">{CAPABILITY_REGISTRY[activeId]?.name}</span>
        </div>

        {/* Right: Controls */}
        <div className="flex flex-1 justify-end items-center gap-3">
          <button
            type="button"
            onClick={() => setIsShortcutsOpen(true)}
            title="Keyboard Shortcuts (?)"
            aria-label="Keyboard Shortcuts"
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <span className="hidden xl:inline">Shortcuts</span>
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
