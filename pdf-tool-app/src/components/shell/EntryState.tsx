"use client";

import { useState, useEffect } from "react";
import { CommandBar } from "./CommandBar";

const PHRASES = [
  "work with PDFs",
  "edit your documents",
  "delete unwanted pages",
  "change text",
  "merge files",
  "split documents",
  "add page numbers",
  "work with Word",
  "work with Excel",
  "convert your files"
];

function TypewriterEffect() {
  const [index, setIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [reverse, setReverse] = useState(false);

  useEffect(() => {
    if (subIndex === PHRASES[index].length + 1 && !reverse) {
      const timeout = setTimeout(() => setReverse(true), 2000);
      return () => clearTimeout(timeout);
    }
    
    if (subIndex === 0 && reverse) {
      setReverse(false);
      setIndex((prev) => (prev + 1) % PHRASES.length);
      return;
    }

    const timeout = setTimeout(() => {
      setSubIndex((prev) => prev + (reverse ? -1 : 1));
    }, reverse ? 30 : 60);

    return () => clearTimeout(timeout);
  }, [subIndex, index, reverse]);

  return (
    <span className="text-xl md:text-2xl text-blue-200/90 font-sans font-light tracking-wide flex items-center justify-center">
      {PHRASES[index].substring(0, subIndex)}
      <span className="w-[1px] h-[1em] bg-blue-200/90 ml-[2px] animate-[pulse_1s_ease-in-out_infinite]"></span>
    </span>
  );
}

export function EntryState() {
  return (
    <section 
      className="w-full min-h-[90vh] flex flex-col"
      style={{
        backgroundImage: `linear-gradient(to bottom, #2400c6, #1f36d3, #2a54dd, #416fe3, #5d88e6, #7a99e9, #94aaeb, #acbced, #c5cbf1, #dadcf5, #eeedfa, #ffffff)`
      }}
    >
      <nav className="w-full max-w-7xl mx-auto px-6 py-6 flex justify-between items-center text-white">
        <div className="font-sans font-bold text-xl tracking-tight">layah.tools</div>
        <div className="flex gap-8 items-center text-sm font-medium">
          <a href="#workspace" className="opacity-90 hover:opacity-100 transition-opacity">PDF</a>
          <span className="opacity-60 cursor-not-allowed hidden md:inline">Word</span>
          <span className="opacity-60 cursor-not-allowed hidden md:inline">Excel</span>
          <span className="opacity-60 cursor-not-allowed hidden md:inline">More</span>
          <a href="#" className="opacity-90 hover:opacity-100 transition-opacity">Sign In</a>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24 text-center">
        <h1 className="font-display text-5xl md:text-7xl lg:text-[5.5rem] font-medium leading-tight text-white mb-6 max-w-4xl tracking-tight">
          Get more done with your files.
        </h1>
        <div className="h-8 mb-16 flex items-center justify-center">
          <TypewriterEffect />
        </div>
        <CommandBar />
      </div>
    </section>
  );
}
