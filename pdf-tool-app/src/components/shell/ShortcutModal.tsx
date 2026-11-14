"use client";

import React, { useEffect } from "react";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";

interface ShortcutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutModal({ isOpen, onClose }: ShortcutModalProps) {
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

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2
              id="shortcut-modal-title"
              className="text-xl font-display text-slate-900 font-normal"
            >
              Keyboard Shortcuts
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Speed up your document workflow with built-in shortcuts
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts modal"
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.name} className="space-y-2.5">
              <div className="border-b border-slate-100 pb-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  {group.name}
                </h3>
                <p className="text-[11px] text-slate-500">{group.description}</p>
              </div>

              <div className="divide-y divide-slate-100">
                {group.shortcuts.map((shortcut, idx) => (
                  <div
                    key={idx}
                    className="py-2 flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-slate-800 font-medium">
                        {shortcut.description}
                      </span>
                      {shortcut.context && (
                        <span className="text-slate-400 ml-1.5 text-[11px]">
                          ({shortcut.context})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {shortcut.keys.map((k, kIdx) => (
                        <React.Fragment key={kIdx}>
                          {kIdx > 0 && <span className="text-slate-400 text-[10px]">+</span>}
                          <kbd className="px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded shadow-[0_1px_0_1px_rgba(0,0,0,0.04)]">
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex justify-between items-center text-xs text-slate-500">
          <span>Press <kbd className="font-mono font-semibold px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-700">Esc</kbd> to close</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

