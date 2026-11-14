"use client";

import React from "react";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  onDismiss,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`border border-red-200 bg-red-50/70 rounded-xl p-5 text-left flex flex-col gap-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="text-red-500 shrink-0 mt-0.5">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-red-900 tracking-tight">
            {title}
          </h4>
          <p className="text-xs text-red-700 mt-0.5 leading-relaxed break-words">
            {message}
          </p>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="text-red-400 hover:text-red-700 p-1 rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {onRetry && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-md hover:bg-red-700 transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

