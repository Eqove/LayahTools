"use client";

import { useApp } from "@/lib/state/app-state";
import { EntryState } from "./EntryState";
import { FormatSwitcher } from "./FormatSwitcher";
import { WorkspaceShell } from "./WorkspaceShell";
import { Workspace } from "@/components/workspace/Workspace";

export function LayahShell() {
  const { isWorkspaceActive } = useApp();

  if (isWorkspaceActive) {
    return (
      <div className="w-full h-screen overflow-hidden bg-slate-50 animate-in fade-in duration-300">
        <Workspace />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fa] animate-in fade-in duration-500">
      <EntryState />

      <div className="h-24 bg-white"></div>

      <section id="workspace" className="w-full bg-white flex-1 pb-32">
        <div className="max-w-7xl mx-auto px-6">
          <FormatSwitcher />
          <WorkspaceShell />
        </div>
      </section>

      <footer className="w-full bg-slate-50 border-t border-slate-200 py-16 mt-auto">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div>
            <div className="font-bold text-xl tracking-tight text-slate-900 mb-4 font-sans">LayahTools</div>
            <p className="text-sm text-slate-500 leading-relaxed">
              The easiest way to get work done with files. Fast, private, and AI-powered.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-slate-900 mb-4">Formats</h4>
            <ul className="space-y-3 text-sm text-slate-500">
              <li><a href="#workspace" className="hover:text-layah-primary transition-colors">PDF</a></li>
              <li className="opacity-50">Word</li>
              <li className="opacity-50">Excel</li>
              <li className="opacity-50">Images</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-slate-900 mb-4">Company</h4>
            <ul className="space-y-3 text-sm text-slate-500">
              <li><a href="#" className="hover:text-layah-primary transition-colors">About</a></li>
              <li><a href="#" className="hover:text-layah-primary transition-colors">Contact</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-slate-900 mb-4">Resources</h4>
            <ul className="space-y-3 text-sm text-slate-500">
              <li><a href="#" className="hover:text-layah-primary transition-colors">How It Works</a></li>
              <li><a href="#" className="hover:text-layah-primary transition-colors">Privacy</a></li>
              <li><a href="#" className="hover:text-layah-primary transition-colors">Terms</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
