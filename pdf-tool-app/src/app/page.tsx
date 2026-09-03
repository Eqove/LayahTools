"use client";

import { useState } from "react";
import { PdfStudio } from "@/components/pdf-studio";

export default function Home() {
  const [showWorkspace, setShowWorkspace] = useState(false);

  return (
    <main className="flex flex-col min-h-screen">
      {/* 
        HERO SECTION 
        Takes up the full viewport on desktop (min-h-screen).
        Uses the canonical blue gradient.
      */}
      <section 
        className="w-full min-h-screen flex flex-col"
        style={{
          backgroundImage: `linear-gradient(to bottom, #2400c6, #1f36d3, #2a54dd, #416fe3, #5d88e6, #7a99e9, #94aaeb, #acbced, #c5cbf1, #dadcf5, #eeedfa, #ffffff)`
        }}
      >
        {/* NAVIGATION */}
        <nav className="w-full max-w-7xl mx-auto px-6 py-6 flex justify-between items-center text-white">
          <div className="font-bold text-xl tracking-tight">layah.tools</div>
          <div className="flex gap-8 items-center text-sm font-medium">
            <a href="#pdf-tools" className="opacity-90 hover:opacity-100 transition-opacity">PDF Tools</a>
            <span className="opacity-60 cursor-not-allowed hidden md:inline">Word</span>
            <span className="opacity-60 cursor-not-allowed hidden md:inline">Excel</span>
            <span className="opacity-60 cursor-not-allowed hidden md:inline">More</span>
            <a href="#" className="opacity-90 hover:opacity-100 transition-opacity">Sign In</a>
          </div>
        </nav>

        {/* HERO CONTENT */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24 text-center">
          <h1 className="font-display text-5xl md:text-7xl lg:text-[5.5rem] font-medium leading-tight text-white mb-6 max-w-4xl tracking-tight">
            Get more done with your files.
          </h1>
          <p className="text-xl md:text-2xl text-blue-100 mb-16 max-w-2xl font-light">
            LayahTools helps you work with documents and files quickly without unnecessary complexity.
          </p>

          {/* INTEGRATED AI PROMPT */}
          <div className="w-full max-w-2xl bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-white/20 transition-all hover:shadow-blue-900/20">
            <div className="p-4 bg-slate-50/50 border-b border-slate-100 text-left">
              <span className="text-slate-500 font-medium text-sm">Tell us what you want to do with your files...</span>
            </div>
            <textarea
              className="w-full min-h-[120px] p-6 text-lg text-slate-800 bg-transparent resize-none focus:outline-none placeholder:text-slate-300"
              placeholder="e.g. Remove pages 51, 53 and 61, add page numbers, and merge these PDFs."
              disabled
            />
            <div className="p-4 flex justify-between items-center bg-white">
              <button 
                type="button" 
                className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors opacity-60 cursor-not-allowed"
                aria-label="Upload files"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </button>
              <button 
                type="button"
                className="w-10 h-10 rounded-full bg-layah-primary text-white flex items-center justify-center hover:bg-blue-600 transition-colors opacity-60 cursor-not-allowed shadow-md"
                aria-label="Submit workflow"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 
        GENEROUS SPACING 
        Ensures the PDF tools section doesn't peek into the hero on desktop.
      */}
      <div className="h-32 bg-white"></div>

      {/* PDF TOOLS SECTION */}
      <section id="pdf-tools" className="w-full bg-white px-6 pb-32">
        <div className="max-w-7xl mx-auto flex flex-col items-center text-center">
          <span className="text-xs font-bold tracking-widest uppercase text-slate-400 mb-4">Current Capabilities</span>
          <h2 className="font-display text-4xl md:text-5xl mb-6 text-slate-900">PDF Tools</h2>
          <p className="text-lg text-slate-500 mb-10 max-w-xl">
            Everything you need to work with PDFs. Merge, split, rotate, watermark, and format your documents instantly.
          </p>
          
          {!showWorkspace && (
            <button 
              onClick={() => setShowWorkspace(true)}
              className="bg-layah-primary text-white px-8 py-4 rounded-xl font-medium text-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              Start working &rarr;
            </button>
          )}

          {/* EMBEDDED WORKSPACE EXPANSION */}
          {showWorkspace && (
            <div className="w-full mt-16 animate-in fade-in slide-in-from-bottom-8 duration-500">
              {/* Note: This is the legacy component for Phase 1. Will be replaced in Phase 2/3. */}
              <PdfStudio />
            </div>
          )}
        </div>
      </section>

      {/* FUTURE TOOL CATEGORIES */}
      <section className="w-full bg-slate-50 py-32 border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="font-display text-3xl md:text-4xl text-center text-slate-800 mb-16">The LayahTools Platform</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { name: 'Word Tools', desc: 'Edit and format Word documents.' },
              { name: 'Excel Tools', desc: 'Process and analyze spreadsheets.' },
              { name: 'PowerPoint Tools', desc: 'Manage presentations and slides.' },
              { name: 'Image Tools', desc: 'Convert and optimize images.' }
            ].map((cat, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-8 text-center opacity-60">
                <h4 className="font-bold text-slate-800 mb-2">{cat.name}</h4>
                <p className="text-sm text-slate-500 mb-6">{cat.desc}</p>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-3 py-1.5 rounded-full">In Development</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="w-full bg-white border-t border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div>
            <div className="font-bold text-xl tracking-tight text-slate-900 mb-4">layah.tools</div>
            <p className="text-sm text-slate-500 leading-relaxed">
              A document productivity platform focused on speed, privacy, and simplicity.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-slate-900 mb-4">Product</h4>
            <ul className="space-y-3 text-sm text-slate-500">
              <li><a href="#pdf-tools" className="hover:text-layah-primary transition-colors">PDF Tools</a></li>
              <li className="opacity-50">Word Tools</li>
              <li className="opacity-50">Excel Tools</li>
              <li className="opacity-50">Image Tools</li>
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
    </main>
  );
}
