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

/**
 * Move a file entry from one position to another.
 * Supports both index-based (from: number, to: number) and ID-based (from: string, to: string | null).
 *
 * Index-based:
 * - Moves item from index `from` to index `to`.
 * - Safely handles invalid indexes, empty collections, and moving to same position.
 * - Always returns a new array without mutating the input array.
 *
 * ID-based:
 * - `from`: the id of the file being moved.
 * - `to`: the id of the target file (inserted before it), or `null` to move to the end.
 */
export function reorderFiles(
  items: WorkspaceFile[],
  from: string | number,
  to: string | number | null
): WorkspaceFile[] {
  if (!items || items.length <= 1) return [...(items || [])];

  // Number / index-based reordering
  if (typeof from === "number" && typeof to === "number") {
    if (
      from < 0 ||
      from >= items.length ||
      to < 0 ||
      to >= items.length ||
      from === to
    ) {
      return [...items];
    }
    const result = [...items];
    const [moved] = result.splice(from, 1);
    result.splice(to, 0, moved);
    return result;
  }

  // ID-based reordering
  const fromId = String(from);
  const fromIdx = items.findIndex((i) => i.id === fromId);
  if (fromIdx === -1) return [...items];

  const moved = items[fromIdx];
  const without = items.filter((i) => i.id !== fromId);

  if (to === null) return [...without, moved];

  const toId = String(to);
  if (fromId === toId) return [...items];

  const toIdx = without.findIndex((i) => i.id === toId);
  if (toIdx === -1) return [...without, moved];

  const result = [...without];
  result.splice(toIdx, 0, moved);
  return result;
}
