/** Pure workspace file-collection logic (no React) so it can be unit-tested with plain node. */

export type WorkspaceFile = { id: string; file: File };

export const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

export interface AddResult {
  items: WorkspaceFile[];
  added: WorkspaceFile[];
  nonPdf: number;
  duplicates: number;
}

/**
 * Append picked files. Never removes or reorders existing entries.
 * Identical re-selection (name+size+modified time) is skipped; same name with different content is kept as a new entry.
 */
export function addFiles(items: WorkspaceFile[], picked: File[], newId: () => string): AddResult {
  const pdfs = picked.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const fresh = pdfs.filter(
    (f, i) => !items.some((e) => sameFile(e.file, f)) && pdfs.findIndex((g) => sameFile(g, f)) === i
  );
  const added = fresh.map((file) => ({ id: newId(), file }));
  return { items: [...items, ...added], added, nonPdf: picked.length - pdfs.length, duplicates: pdfs.length - added.length };
}

export const removeFile = (items: WorkspaceFile[], id: string) => items.filter((i) => i.id !== id);

/** Edits swap the bytes of an entry but keep its id and position. */
export const replaceFile = (items: WorkspaceFile[], id: string, file: File) =>
  items.map((i) => (i.id === id ? { id, file } : i));

/** The active entry, falling back to the first if the active one was removed. */
export const resolveActive = (items: WorkspaceFile[], activeId: string | null) =>
  items.find((i) => i.id === activeId) ?? items[0];
