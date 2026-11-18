"use client";

/**
 * DOCX workspace queue state.
 *
 * React state only: this hook is not shared with the PDF workspace and does not register
 * anything in the PDF capability registry. All queue mutations and validation are delegated
 * to `src/lib/docx/files.ts` so the UI never grows a second validation system.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DOCX_LIMITS } from "@/lib/docx/constants";
import {
  addDocxFiles,
  removeDocxFile,
  reorderDocxFiles,
  validateDocxQueue,
} from "@/lib/docx/files";
import type { AddDocxFilesResult, DocxQueueItem } from "@/lib/docx/types";

export type DocxItemValidation =
  | { status: "checking" }
  | { status: "valid" }
  | { status: "invalid"; message: string };

export type DocxValidationMap = Partial<Record<string, DocxItemValidation>>;

export interface DocxQueueState {
  items: DocxQueueItem[];
  validation: DocxValidationMap;
  /** Set only when the queue itself fails unexpectedly, never for a single rejected file. */
  error: string | null;
  addFiles: (files: File[]) => AddDocxFilesResult;
  removeItem: (id: string) => DocxQueueItem | null;
  moveItem: (id: string, direction: -1 | 1) => DocxQueueItem | null;
  clearError: () => void;
}

export function useDocxQueue(): DocxQueueState {
  const [items, setItems] = useState<DocxQueueItem[]>([]);
  const [validation, setValidation] = useState<DocxValidationMap>({});
  const [error, setError] = useState<string | null>(null);

  // Mirror the committed list so synchronous helpers can read the latest queue.
  const itemsRef = useRef<DocxQueueItem[]>([]);
  const nextId = useRef(0);

  // Keep the mirror correct if React preserves state across a re-mount (e.g. Fast Refresh).
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const newId = useCallback(
    () => `docx-${Date.now().toString(36)}-${++nextId.current}`,
    []
  );

  const commit = useCallback((next: DocxQueueItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const runValidation = useCallback(async (added: DocxQueueItem[]) => {
    if (added.length === 0) return;

    setValidation((current) => {
      const next = { ...current };
      for (const item of added) next[item.id] = { status: "checking" };
      return next;
    });

    try {
      const result = await validateDocxQueue(added, DEFAULT_DOCX_LIMITS);
      setValidation((current) => {
        const next = { ...current };
        for (const entry of result.entries) {
          // Ignore a result whose file was removed while validation was running.
          if (!itemsRef.current.some((item) => item.id === entry.id)) continue;
          next[entry.id] = entry.result.ok
            ? { status: "valid" }
            : { status: "invalid", message: entry.result.error.message };
        }
        return next;
      });
    } catch {
      setValidation((current) => {
        const next = { ...current };
        for (const item of added) {
          if (!itemsRef.current.some((entry) => entry.id === item.id)) continue;
          next[item.id] = {
            status: "invalid",
            message: "This file could not be checked. Try removing it and adding it again.",
          };
        }
        return next;
      });
      setError(
        "The file queue could not be validated. Remove the affected files and try adding them again."
      );
    }
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      setError(null);
      const result = addDocxFiles(itemsRef.current, files, newId, DEFAULT_DOCX_LIMITS);
      if (result.added.length > 0) {
        commit(result.items);
        void runValidation(result.added);
      }
      return result;
    },
    [commit, newId, runValidation]
  );

  const removeItem = useCallback(
    (id: string) => {
      const removed = itemsRef.current.find((item) => item.id === id) ?? null;
      if (!removed) return null;

      commit(removeDocxFile(itemsRef.current, id));
      setValidation((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setError(null);
      return removed;
    },
    [commit]
  );

  const moveItem = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = itemsRef.current;
      const index = current.findIndex((item) => item.id === id);
      if (index === -1) return null;

      const target = index + direction;
      if (target < 0 || target >= current.length) return null;

      const moved = current[index];
      commit(reorderDocxFiles(current, index, target));
      return moved;
    },
    [commit]
  );

  const clearError = useCallback(() => setError(null), []);

  return { items, validation, error, addFiles, removeItem, moveItem, clearError };
}
