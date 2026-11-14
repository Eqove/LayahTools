"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log in development only
    if (process.env.NODE_ENV !== "production") {
      console.error("App Router Error Caught:", error);
    }
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4 py-12">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        <div className="w-14 h-14 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-center mx-auto mb-5 text-red-600">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <h1 className="text-3xl font-display text-slate-900 mb-2 font-normal">
          Something went wrong
        </h1>
        <p className="text-slate-600 text-sm mb-6 leading-relaxed">
          An unexpected error occurred while rendering the workspace. Your local files in this session remain safe.
        </p>

        {isDev && error.message && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-md text-left">
            <p className="text-xs font-mono font-semibold text-red-800 break-words">
              {error.message}
            </p>
            {error.digest && (
              <p className="text-[10px] font-mono text-red-600 mt-1">
                Digest: {error.digest}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="w-full sm:w-auto px-5 py-2.5 bg-layah-primary text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Reload workspace
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.href = "/";
              }
            }}
            className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Return to home
          </button>
        </div>
      </div>
    </div>
  );
}

