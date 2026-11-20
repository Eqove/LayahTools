"use client";

import { useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { useApp } from "@/lib/state/app-state";
import { CAPABILITY_REGISTRY } from "@/lib/capabilities/registry";
import { TOOL_GROUPS, searchTools, isLocked } from "@/lib/capabilities/groups";
import { LockIcon } from "@/components/shell/LockIcon";
import { ShortcutModal } from "@/components/shell/ShortcutModal";
import { useInstallPrompt } from "@/components/shell/Pwa";

/** Type a plain word ("sign", "smaller", "jpg") and jump to the tool. Enter picks the first match. */
function ToolSearch({ onPick, className, autoFocus }: { onPick: (id: string) => void; className?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const matches = searchTools(q).slice(0, 6);
  const pick = (id: string) => { onPick(id); setQ(""); setOpen(false); };
  return (
    <div className={clsx("relative", className)}>
      <svg className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        placeholder="Find a tool: sign, smaller, jpg…"
        aria-label="Find a tool"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls="tool-search-results"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && matches[hi]) pick(matches[hi].id);
          else if (e.key === "Escape") { setQ(""); setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
        className="w-full h-9 pl-8 pr-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {open && q.trim() && (
        <div id="tool-search-results" role="listbox" className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
          {matches.length ? matches.map((c, i) => (
            <button key={c.id} type="button" role="option" aria-selected={i === hi}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c.id)} onMouseEnter={() => setHi(i)}
              className={clsx("w-full text-left px-3 py-2", i === hi ? "bg-blue-50" : "")}>
              <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900">{c.name}{isLocked(c) && <LockIcon />}</span>
              <span className="block text-xs text-slate-500 truncate">{c.summary}</span>
            </button>
          )) : <p className="px-3 py-2 text-sm text-slate-500">No tool matches “{q.trim()}”.</p>}
        </div>
      )}
    </div>
  );
}

export function WorkspaceHeader({ goHome, onSelectTool }: { goHome: () => void; onSelectTool?: () => void }) {
  const { activeCapabilityId: activeId, setActiveCapabilityId } = useApp();
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const { install } = useInstallPrompt();
  const choose = (id: string | null) => { setActiveCapabilityId(id); onSelectTool?.(); setOpenMenu(null); };

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
        <div className="flex flex-1 items-center gap-4 min-w-0">
          <button
            onClick={goHome}
            className="font-sans font-bold text-xl tracking-tight text-slate-900 hover:text-layah-primary transition-colors"
          >
            LayahTools
          </button>
          <span className="hidden md:block text-sm font-medium text-layah-primary border-b-2 border-layah-primary py-1">PDF</span>
          <div ref={navRef} className="flex items-center">
          <nav aria-label="PDF tools" className="hidden md:flex items-center gap-1 ml-2">
            <button
              type="button"
              onClick={() => choose(null)}
              title="Start screen: pick what to do with your file"
              className={clsx("px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap", !activeId ? "text-layah-primary bg-blue-50" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}
            >
              All tools
            </button>
            {TOOL_GROUPS.map((g) => {
              const open = openMenu === g.id;
              const hasActive = !!activeId && CAPABILITY_REGISTRY[activeId]?.category === g.id;
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
                          onClick={() => choose(cap.id)}
                          className={clsx(
                            "w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2",
                            cap.id === activeId ? "bg-blue-50 text-layah-primary font-medium" : "text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          {cap.name}{isLocked(cap) && <LockIcon />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          {/* Phone: one Tools button opens a full-width list with search at the top */}
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
                <ToolSearch onPick={choose} className="mb-3" />
                <button role="menuitem" onClick={() => choose(null)}
                  className={clsx("w-full text-left px-3 py-2.5 mb-2 rounded-md text-base font-medium", !activeId ? "bg-blue-50 text-layah-primary" : "text-slate-700 bg-slate-50")}>
                  All tools (start screen)
                </button>
                {TOOL_GROUPS.map((g) => (
                  <div key={g.id} className="mb-3">
                    <div className="px-2 py-1 text-xs font-bold tracking-widest uppercase text-slate-400">{g.title}</div>
                    {g.items.map((cap) => (
                      <button
                        key={cap.id}
                        role="menuitem"
                        onClick={() => choose(cap.id)}
                        className={clsx("w-full text-left px-3 py-2.5 rounded-md text-base flex items-center justify-between gap-2", cap.id === activeId ? "bg-blue-50 text-layah-primary font-medium" : "text-slate-700")}
                      >
                        {cap.name}{isLocked(cap) && <LockIcon className="w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
          {activeId && <span className="hidden 2xl:block ml-1 pl-4 border-l border-slate-200 text-sm font-semibold text-slate-900 truncate" aria-live="polite">{CAPABILITY_REGISTRY[activeId]?.name}</span>}
        </div>

        {/* Right: search, install, shortcuts */}
        <div className="flex justify-end items-center gap-2 md:gap-3 shrink-0">
          <ToolSearch onPick={choose} className="hidden lg:block w-44 2xl:w-64" />
          {install && (
            <button
              type="button"
              onClick={install}
              title="Install LayahTools as an app. It opens like a normal app and works offline."
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-layah-primary bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg transition-colors whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
              Install app
            </button>
          )}
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
            <span className="hidden 2xl:inline">Shortcuts</span>
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
