"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// The browser fires `beforeinstallprompt` once, early; keep it here so any component can offer "Install app".
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Mounted once in the root layout: registers the offline service worker and captures the install prompt. */
export function PwaRegister() {
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as InstallEvent; notify(); };
    const onInstalled = () => { deferred = null; notify(); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Dev server rebuilds constantly; a caching worker there would serve stale code.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is optional */ });
    }
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  return null;
}

/** `install` is null when the browser has not offered installation (already installed, unsupported, or iOS). */
export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  if (!deferred) return { install: null };
  return {
    install: async () => {
      const e = deferred;
      if (!e) return;
      await e.prompt();
      await e.userChoice.catch(() => null);
      deferred = null;
      notify();
    },
  };
}
