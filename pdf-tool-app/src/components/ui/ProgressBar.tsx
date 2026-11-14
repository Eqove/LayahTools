"use client";

import React from "react";

interface ProgressBarProps {
  current: number;
  total: number;
  label?: string;
  unit?: string;
  className?: string;
}

export function ProgressBar({
  current,
  total,
  label,
  unit = "steps",
  className = "",
}: ProgressBarProps) {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(Math.max(0, current), safeTotal);
  const percentage = Math.round((safeCurrent / safeTotal) * 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={safeCurrent}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-label={label || `Progress: ${percentage}%`}
      className={`w-full max-w-sm mx-auto flex flex-col gap-2 ${className}`}
    >
      <div className="flex justify-between items-center text-xs text-slate-600 font-medium">
        <span>{label || "Processing..."}</span>
        <span className="font-mono text-slate-500">
          {safeCurrent} / {safeTotal} {unit} ({percentage}%)
        </span>
      </div>

      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
        <div
          className="h-full bg-layah-primary transition-all duration-300 ease-out rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

