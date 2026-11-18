/**
 * Bookmark reconciliation for phase 9.2.
 *
 * Bookmark IDs are numeric and document-scoped, so imported bookmarks receive freshly allocated
 * integers rather than reusing source IDs. Bookmark names are preserved unless they collide with
 * the host or an earlier imported document; a collision gets a deterministic `_<n>` suffix and
 * every internal anchor in the same source is rewritten with it.
 *
 * A source with unmatched start/end pairs, duplicate IDs or duplicate names is rejected before
 * any output is produced.
 */

import { WORD_NAMESPACE } from "../constants";
import { DocxErrors } from "../errors";
import { parseNonNegativeInt, setWordAttribute, wordAttribute } from "./package";

export interface BookmarkAnalysis {
  /** Bookmark start IDs in document order, without duplicates. */
  startIds: number[];
  /** Bookmark names in document order, without duplicates. */
  names: string[];
  /** Hyperlink elements that use `w:anchor`, with their target name. */
  anchors: { element: Element; name: string }[];
}

export interface BookmarkPlan {
  fileName: string;
  /** Source bookmark ID -> allocated merged-document ID. */
  idMap: Map<number, number>;
  /** Source bookmark name -> final merged-document name. */
  renames: Map<string, string>;
  bookmarkCount: number;
  renamedIds: number;
}

export interface BookmarkPlans {
  plans: BookmarkPlan[];
  /** Every bookmark name available in the merged document. */
  finalNames: Set<string>;
  hostBookmarkCount: number;
}

function requireBody(document: Document, fileName: string): Element {
  const bodies = document.getElementsByTagNameNS(WORD_NAMESPACE, "body");
  if (bodies.length === 0) {
    throw DocxErrors.unsupportedStructure(
      `"${fileName}" has no document body.`,
      "word/document.xml"
    );
  }
  return bodies[0];
}

const bookmarkId = (element: Element, fileName: string, side: string): number => {
  const id = parseNonNegativeInt(wordAttribute(element, "id"));
  if (id === null) {
    throw DocxErrors.unsupportedStructure(
      `"${fileName}" has a bookmark ${side} with a missing or invalid ID.`,
      `${element.nodeName} w:id=${wordAttribute(element, "id") ?? "(missing)"}`
    );
  }
  return id;
};

/** Validates bookmark structure and returns the IDs, names and internal anchors in order. */
export function analyzeBookmarks(document: Document, fileName: string): BookmarkAnalysis {
  const body = requireBody(document, fileName);
  const starts = body.getElementsByTagNameNS(WORD_NAMESPACE, "bookmarkStart");
  const ends = body.getElementsByTagNameNS(WORD_NAMESPACE, "bookmarkEnd");

  const startNames = new Map<number, string>();
  const startIds: number[] = [];
  const names: string[] = [];
  const namesSeen = new Set<string>();

  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const id = bookmarkId(start, fileName, "start");
    if (startNames.has(id)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" starts the same bookmark ID more than once.`,
        `w:bookmarkStart w:id=${id}`
      );
    }
    const name = wordAttribute(start, "name");
    if (!name || name.trim().length === 0) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" has a bookmark without a name.`,
        `w:bookmarkStart w:id=${id}`
      );
    }
    if (namesSeen.has(name)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" defines the bookmark name "${name}" more than once.`,
        `w:bookmarkStart w:name=${name}`
      );
    }
    startNames.set(id, name);
    startIds.push(id);
    names.push(name);
    namesSeen.add(name);
  }

  const endIds = new Set<number>();
  for (let index = 0; index < ends.length; index++) {
    const end = ends[index];
    const id = bookmarkId(end, fileName, "end");
    if (endIds.has(id)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" ends the same bookmark ID more than once.`,
        `w:bookmarkEnd w:id=${id}`
      );
    }
    endIds.add(id);
  }

  for (const id of startNames.keys()) {
    if (!endIds.has(id)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" has a bookmark start without a matching end.`,
        `w:bookmarkStart w:id=${id} (${startNames.get(id)})`
      );
    }
  }
  for (const id of endIds) {
    if (!startNames.has(id)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" has a bookmark end without a matching start.`,
        `w:bookmarkEnd w:id=${id}`
      );
    }
  }

  const anchors: { element: Element; name: string }[] = [];
  const hyperlinks = body.getElementsByTagNameNS(WORD_NAMESPACE, "hyperlink");
  for (let index = 0; index < hyperlinks.length; index++) {
    const element = hyperlinks[index];
    const anchor = wordAttribute(element, "anchor");
    if (anchor !== null) anchors.push({ element, name: anchor });
  }

  return { startIds, names, anchors };
}

/** Host bookmark IDs and names, read without rejecting the host's own (allowed) content. */
function hostBookmarkState(document: Document, fileName: string): {
  ids: Set<number>;
  names: Set<string>;
  count: number;
} {
  const body = requireBody(document, fileName);
  const ids = new Set<number>();
  const names = new Set<string>();
  let count = 0;

  const starts = body.getElementsByTagNameNS(WORD_NAMESPACE, "bookmarkStart");
  for (let index = 0; index < starts.length; index++) {
    const id = parseNonNegativeInt(wordAttribute(starts[index], "id"));
    if (id !== null) ids.add(id);
    const name = wordAttribute(starts[index], "name");
    if (name) names.add(name);
    if (id !== null) count++;
  }
  const ends = body.getElementsByTagNameNS(WORD_NAMESPACE, "bookmarkEnd");
  for (let index = 0; index < ends.length; index++) {
    const id = parseNonNegativeInt(wordAttribute(ends[index], "id"));
    if (id !== null) ids.add(id);
  }
  return { ids, names, count };
}

const nextBookmarkId = (used: Set<number>): number => {
  let candidate = 0;
  while (used.has(candidate)) candidate++;
  if (!Number.isSafeInteger(candidate)) {
    throw DocxErrors.unsupportedStructure(
      "The merged document needs more bookmarks than this workspace supports."
    );
  }
  used.add(candidate);
  return candidate;
};

/** Word limits bookmark names to 40 characters; renamed names stay within that limit. */
const BOOKMARK_NAME_LIMIT = 40;

const uniqueName = (base: string, used: Set<string>): string => {
  let counter = 2;
  for (;;) {
    const suffix = `_${counter}`;
    const stem = base.slice(0, Math.max(1, BOOKMARK_NAME_LIMIT - suffix.length));
    const candidate = `${stem}${suffix}`;
    if (!used.has(candidate)) return candidate;
    counter++;
  }
};

/**
 * Plans numeric IDs and name renames for every non-host source, in merge order.
 * Names already used by the host win; later imports are renamed deterministically.
 */
export function planBookmarks(
  hostDocument: Document,
  hostFileName: string,
  sources: readonly { fileName: string; document: Document }[]
): BookmarkPlans {
  const host = hostBookmarkState(hostDocument, hostFileName);
  const usedIds = new Set(host.ids);
  const usedNames = new Set(host.names);
  const plans: BookmarkPlan[] = [];
  // Analysed once: the same source is inspected again below for cross-document anchors.
  const analyses = sources.map((source) => analyzeBookmarks(source.document, source.fileName));

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    const analysis = analyses[index];
    const idMap = new Map<number, number>();
    for (const id of analysis.startIds) {
      idMap.set(id, nextBookmarkId(usedIds));
    }

    const renames = new Map<string, string>();
    let renamedIds = 0;
    for (const name of analysis.names) {
      const finalName = usedNames.has(name) ? uniqueName(name, usedNames) : name;
      renames.set(name, finalName);
      usedNames.add(finalName);
      if (finalName !== name) renamedIds++;
    }

    plans.push({
      fileName: source.fileName,
      idMap,
      renames,
      bookmarkCount: analysis.startIds.length,
      renamedIds,
    });
  }

  // Anchors may resolve against the same source document or the host. An anchor that only
  // matches a bookmark introduced by another imported document would be ambiguous after the
  // merge (and could silently point at the wrong bookmark), so it is refused.
  for (let index = 0; index < sources.length; index++) {
    const analysis = analyses[index];
    const plan = plans[index];
    for (const anchor of analysis.anchors) {
      const ownName = plan.renames.has(anchor.name);
      const finalName = plan.renames.get(anchor.name) ?? anchor.name;
      if (!ownName && !host.names.has(anchor.name)) {
        throw DocxErrors.unsupportedStructure(
          `"${sources[index].fileName}" links to a bookmark that is not defined in the same document or the host.`,
          `w:anchor=${anchor.name}`
        );
      }
      if (!usedNames.has(finalName)) {
        throw DocxErrors.unsupportedStructure(
          `"${sources[index].fileName}" links to a bookmark that does not exist.`,
          `w:anchor=${anchor.name}`
        );
      }
    }
  }

  return { plans, finalNames: usedNames, hostBookmarkCount: host.count };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Descendants with a local name, plus `root` itself when it matches.
 * `getElementsByTagNameNS` excludes the root, which matters because body content is imported one
 * top-level element at a time.
 */
function namedElements(root: Element, localName: string): Element[] {
  const elements: Element[] = [];
  if (root.namespaceURI === WORD_NAMESPACE && root.localName === localName) elements.push(root);
  const list = root.getElementsByTagNameNS(WORD_NAMESPACE, localName);
  for (let index = 0; index < list.length; index++) {
    const element = list[index];
    if (!elements.includes(element)) elements.push(element);
  }
  return elements;
}

/**
 * Replaces whole-token bookmark names in one pass.
 *
 * Sequential replacement is not safe when renames form a chain: with `X -> X_2` and
 * `X_2 -> X_2_2`, rewriting `X` first would then rewrite the freshly produced `X_2` again and
 * point the field at the wrong bookmark. Matching every old name in a single pass, longest first,
 * keeps each token independent.
 */
const replaceBookmarkTokens = (value: string, renames: ReadonlyMap<string, string>): string => {
  const active = [...renames.entries()].filter(([oldName, newName]) => oldName !== newName);
  if (active.length === 0) return value;

  const lookup = new Map(active);
  const alternatives = active
    .map(([oldName]) => escapeRegExp(oldName))
    .sort((left, right) => right.length - left.length)
    .join("|");
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_])(?:${alternatives})(?![A-Za-z0-9_])`,
    "g"
  );
  return value.replace(pattern, (token) => lookup.get(token) ?? token);
};

function rewriteFieldInstructions(
  root: Element,
  renames: ReadonlyMap<string, string>,
  fileName: string
): void {
  const renamed = [...renames.entries()].filter(([oldName, newName]) => oldName !== newName);
  if (renamed.length === 0) return;

  const map = new Map(renamed);
  const fldSimple = namedElements(root, "fldSimple");
  for (const element of fldSimple) {
    const instruction = wordAttribute(element, "instr");
    if (instruction === null) continue;
    const rewritten = replaceBookmarkTokens(instruction, map);
    if (rewritten !== instruction) setWordAttribute(element, "instr", rewritten);
  }

  const instructions = namedElements(root, "instrText");
  interface InstructionGroup {
    texts: string[];
    original: string;
  }
  const groups = new Map<Node, InstructionGroup>();

  // Group instruction runs by the paragraph that owns them, keeping the pre-rewrite text so a
  // name split across runs can be detected after each node has been rewritten on its own.
  for (const element of instructions) {
    let owner: Node = root;
    let parent = element.parentNode;
    while (parent) {
      if (
        parent.nodeType === 1 &&
        (parent as Element).namespaceURI === WORD_NAMESPACE &&
        (parent as Element).localName === "p"
      ) {
        owner = parent;
        break;
      }
      parent = parent.parentNode;
    }
    const group = groups.get(owner) ?? { texts: [], original: "" };
    const original = element.textContent ?? "";
    group.texts.push(original);
    group.original += original;
    groups.set(owner, group);
    element.textContent = replaceBookmarkTokens(original, map);
  }

  // A field may still split a renamed name across runs. Rewriting each run cannot see such a
  // token, so compare against a whole-field rewrite and refuse rather than leave a stale
  // reference behind.
  const unresolved: string[] = [];
  for (const group of groups.values()) {
    const wholeField = replaceBookmarkTokens(group.original, map);
    const runByRun = group.texts
      .map((text) => replaceBookmarkTokens(text, map))
      .join("");
    if (wholeField === runByRun) continue;
    for (const [oldName] of renamed) {
      const token = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(oldName)}(?![A-Za-z0-9_])`);
      if (token.test(group.original)) unresolved.push(oldName);
    }
  }
  if (unresolved.length > 0) {
    throw DocxErrors.unsupportedStructure(
      `"${fileName}" references a renamed bookmark in a field that could not be updated safely.`,
      `bookmark: ${[...new Set(unresolved)].join(", ")}`
    );
  }
}

/**
 * Rewrites bookmark IDs, anchors and field references in one imported subtree.
 * `allowedNames` is the final merged-document name set and is enforced defensively.
 */
export function rewriteBookmarks(
  root: Element,
  plan: BookmarkPlan,
  allowedNames: ReadonlySet<string>,
  fileName: string
): void {
  const starts = namedElements(root, "bookmarkStart");
  for (const element of starts) {
    const oldId = parseNonNegativeInt(wordAttribute(element, "id"));
    if (oldId === null || !plan.idMap.has(oldId)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" has a bookmark that could not be renumbered.`,
        `w:bookmarkStart w:id=${wordAttribute(element, "id") ?? "(missing)"}`
      );
    }
    setWordAttribute(element, "id", String(plan.idMap.get(oldId)));

    const oldName = wordAttribute(element, "name");
    if (oldName === null || !plan.renames.has(oldName)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" has a bookmark that could not be renamed safely.`,
        `w:bookmarkStart w:name=${oldName ?? "(missing)"}`
      );
    }
    const finalName = plan.renames.get(oldName) as string;
    if (!allowedNames.has(finalName)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" has a bookmark name that is not unique in the merged document.`,
        `w:bookmarkStart w:name=${oldName}`
      );
    }
    if (finalName !== oldName) setWordAttribute(element, "name", finalName);
  }

  const ends = namedElements(root, "bookmarkEnd");
  for (const element of ends) {
    const oldId = parseNonNegativeInt(wordAttribute(element, "id"));
    if (oldId === null || !plan.idMap.has(oldId)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" has a bookmark end that could not be renumbered.`,
        `w:bookmarkEnd w:id=${wordAttribute(element, "id") ?? "(missing)"}`
      );
    }
    setWordAttribute(element, "id", String(plan.idMap.get(oldId)));
  }

  const hyperlinks = namedElements(root, "hyperlink");
  for (const element of hyperlinks) {
    const anchor = wordAttribute(element, "anchor");
    if (anchor === null) continue;
    const finalName = plan.renames.get(anchor) ?? anchor;
    if (!allowedNames.has(finalName)) {
      throw DocxErrors.unsupportedStructure(
        `"${fileName}" links to a bookmark that does not exist in the merged document.`,
        `w:anchor=${anchor}`
      );
    }
    if (finalName !== anchor) setWordAttribute(element, "anchor", finalName);
  }

  rewriteFieldInstructions(root, plan.renames, fileName);
}
