"use client";

import React from "react";

interface LoadingStateProps {
  message?: string;
  description?: string;
  className?: string;
}

export function LoadingState({
  message = "Loading...",
  description,
  className = "",
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center p-8 text-center ${className}`}
    >
      <div className="relative w-10 h-10 mb-4">
        {/* Outer subtle ring */}
        <div className="w-10 h-10 rounded-full border-2 border-slate-200"></div>
        {/* Spinning accent arc */}
        <div className="absolute top-0 left-0 w-10 h-10 rounded-full border-2 border-layah-primary border-t-transparent animate-spin"></div>
      </div>

      <p className="text-sm font-medium text-slate-800 tracking-tight">
        {message}
      </p>

      {description && (
        <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

