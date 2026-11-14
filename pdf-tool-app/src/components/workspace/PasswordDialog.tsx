"use client";

import React, { useState } from "react";

interface PasswordDialogProps {
  isOpen: boolean;
  fileName: string;
  onUnlock: (password: string) => Promise<void>;
  onCancel: () => void;
}

export function PasswordDialog({
  isOpen,
  fileName,
  onUnlock,
  onCancel,
}: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || isUnlocking) return;

    setIsUnlocking(true);
    setError(null);
    try {
      await onUnlock(password);
      setPassword("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Incorrect password. Please try again.");
    } finally {
      setIsUnlocking(false);
    }
  }

  function handleClose() {
    setPassword("");
    setError(null);
    onCancel();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-center mx-auto mb-4 text-layah-primary">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <h3
          id="password-dialog-title"
          className="text-xl font-display text-slate-900 text-center mb-1 font-normal"
        >
          Password Required
        </h3>

        <p className="text-xs text-slate-500 text-center mb-5 truncate px-2" title={fileName}>
          {fileName} is encrypted. Enter password to view and edit.
        </p>

        {error && (
          <div className="mb-4 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter document password"
              aria-label="Document password"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-hidden focus:border-layah-primary"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isUnlocking}
              className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password.trim() || isUnlocking}
              className="flex-1 px-4 py-2 bg-layah-primary text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isUnlocking ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Unlocking...</span>
                </>
              ) : (
                <span>Unlock</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
