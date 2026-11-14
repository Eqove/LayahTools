"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
    }
  }

  public handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      const isDev = process.env.NODE_ENV !== "production";
      const title = this.props.fallbackTitle || "Document view encountered an issue";

      return (
        <div className="w-full h-full min-h-[300px] flex items-center justify-center p-6 bg-[#f8f9fa]">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
            <div className="w-12 h-12 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-center mx-auto mb-4 text-amber-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <h3 className="text-xl font-display text-slate-900 mb-1 font-normal">
              {title}
            </h3>
            <p className="text-slate-600 text-sm mb-5 leading-relaxed">
              This panel failed to render safely. You can recover by refreshing this view or switching files.
            </p>

            {isDev && this.state.error?.message && (
              <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded text-left">
                <p className="text-xs font-mono font-medium text-red-800 break-words">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-center">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 bg-layah-primary text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

