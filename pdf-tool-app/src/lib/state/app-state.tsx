"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type FormatContextId = "pdf" | "word" | "excel" | "ppt" | "images" | null;

export interface AppState {
  isWorkspaceActive: boolean;
  activeFormat: FormatContextId;
  activeCapabilityId: string | null;
  selectedFiles: File[];
  commandInput: string;
}

export interface AppContextType extends AppState {
  setWorkspaceActive: (active: boolean) => void;
  setActiveFormat: (format: FormatContextId) => void;
  setActiveCapabilityId: (id: string | null) => void;
  setSelectedFiles: (files: File[]) => void;
  setCommandInput: (input: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [isWorkspaceActive, setWorkspaceActiveInternal] = useState<boolean>(false);
  const [activeFormat, setActiveFormat] = useState<FormatContextId>("pdf");
  const [activeCapabilityId, setActiveCapabilityId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [commandInput, setCommandInput] = useState<string>("");

  useEffect(() => {
    // Check initial hash
    if (window.location.hash === "#workspace") {
      setWorkspaceActiveInternal(true);
    }

    const handlePopState = () => {
      setWorkspaceActiveInternal(window.location.hash === "#workspace");
    };
    
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const setWorkspaceActive = (active: boolean) => {
    setWorkspaceActiveInternal(active);
    if (active && window.location.hash !== "#workspace") {
      window.history.pushState(null, "", "#workspace");
    } else if (!active && window.location.hash === "#workspace") {
      window.history.pushState(null, "", window.location.pathname + window.location.search);
    }
  };

  const value: AppContextType = {
    isWorkspaceActive,
    activeFormat,
    activeCapabilityId,
    selectedFiles,
    commandInput,
    setWorkspaceActive,
    setActiveFormat,
    setActiveCapabilityId,
    setSelectedFiles,
    setCommandInput
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
