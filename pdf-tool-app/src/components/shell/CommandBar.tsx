"use client";

import { useState } from "react";
import { useApp } from "@/lib/state/app-state";
import clsx from "clsx";

export function CommandBar() {
  const { commandInput, setCommandInput } = useApp();
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div 
      className={clsx(
        "w-full max-w-3xl mx-auto bg-white/95 backdrop-blur-sm rounded-2xl border border-slate-200 transition-all duration-300 ease-in-out shadow-sm flex flex-col overflow-hidden",
        isFocused ? "shadow-2xl ring-2 ring-blue-300" : "hover:shadow-md hover:border-slate-300"
      )}
    >
      {/* Expanded Header (Only visible on focus) */}
      {isFocused && (
        <div className="p-3 bg-slate-50/50 border-b border-slate-100 text-left animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="text-slate-500 font-medium text-xs uppercase tracking-wider">Layah AI Command</span>
        </div>
      )}

      {/* Main Input Row */}
      <div className={clsx("flex items-center p-2", isFocused ? "h-auto" : "h-14 md:h-16")}>
        <button 
          type="button" 
          className="w-10 h-10 shrink-0 rounded-full text-slate-400 flex items-center justify-center hover:bg-slate-100 hover:text-slate-600 transition-colors"
          aria-label="Upload files"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
        
        {isFocused ? (
          <textarea
            className="flex-1 min-h-[80px] px-4 py-2 text-base text-slate-800 bg-transparent resize-none focus:outline-none placeholder:text-slate-400"
            placeholder="Ask Layah to do something with this document..."
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            autoFocus
          />
        ) : (
          <input
            type="text"
            className="flex-1 h-full px-4 text-base text-slate-800 bg-transparent focus:outline-none placeholder:text-slate-400 cursor-text"
            placeholder="Ask Layah to do something with this document..."
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
          />
        )}

        <button 
          type="button"
          className={clsx(
            "w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors shadow-sm",
            commandInput.trim() ? "bg-layah-primary text-white hover:bg-blue-600" : "bg-slate-100 text-slate-400 cursor-not-allowed"
          )}
          aria-label="Submit workflow"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
        </button>
      </div>
    </div>
  );
}
