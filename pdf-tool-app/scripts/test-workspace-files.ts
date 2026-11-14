import { addFiles, removeFile, replaceFile, resolveActive, reorderFiles, type WorkspaceFile } from "../src/lib/workspace/files";

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed++; };

const pdf = (name: string, size = 10, modified = 1) => new File([new Uint8Array(size)], name, { type: "application/pdf", lastModified: modified });
let n = 0;
const id = () => `f${++n}`;

// sequential uploads append
let items: WorkspaceFile[] = [];
items = addFiles(items, [pdf("a.pdf")], id).items;
items = addFiles(items, [pdf("b.pdf")], id).items;
check("sequential uploads append (2 files)", items.length === 2 && items[0].file.name === "a.pdf" && items[1].file.name === "b.pdf");

// multi-file in one selection
const multi = addFiles(items, [pdf("c.pdf"), pdf("d.pdf"), pdf("e.pdf")], id);
items = multi.items;
check("multi-file selection adds all", items.length === 5 && multi.added.length === 3);
const ids = items.map((i) => i.id);
check("ids unique and earlier ids unchanged", new Set(ids).size === 5 && ids[0] === "f1" && ids[1] === "f2");

// same-file re-selection is skipped, reported
const dup = addFiles(items, [pdf("a.pdf")], id);
check("identical re-selection skipped", dup.items.length === 5 && dup.duplicates === 1);
// duplicate inside one selection
const dup2 = addFiles(items, [pdf("z.pdf"), pdf("z.pdf")], id);
check("duplicate within one selection added once", dup2.items.length === 6 && dup2.duplicates === 1);
// same name, different content -> kept
const same = addFiles(items, [pdf("a.pdf", 99)], id);
check("same filename but different content is kept", same.items.length === 6 && same.items.filter((i) => i.file.name === "a.pdf").length === 2);
// non-PDF skipped
const np = addFiles(items, [new File(["x"], "notes.txt", { type: "text/plain" })], id);
check("non-PDF skipped, collection intact", np.items.length === 5 && np.nonPdf === 1);
// pdf with empty mime but .pdf extension accepted
check("pdf with missing mime type accepted", addFiles([], [new File(["x"], "scan.PDF", { type: "" })], id).items.length === 1);

// active file switching never discards
let active: string | null = items[1].id;
check("active resolves to selected", resolveActive(items, active)?.file.name === "b.pdf");
active = items[3].id;
check("switching active keeps all files", resolveActive(items, active)?.file.name === "d.pdf" && items.length === 5);

// removal explicit + active fallback
items = removeFile(items, items[3].id);
check("removal removes only that file", items.length === 4 && !items.some((i) => i.file.name === "d.pdf"));
check("active falls back to first when removed", resolveActive(items, active)?.file.name === "a.pdf");

// edit replaces bytes, keeps id/position
const target = items[1];
const edited = replaceFile(items, target.id, pdf("b.pdf", 500));
check("replace keeps id and position", edited[1].id === target.id && edited[1].file.size === 500 && edited.length === items.length);
check("replace does not touch other files", edited.filter((_, i) => i !== 1).every((e, i) => e === items.filter((_, j) => j !== 1)[i]));
// removing everything
check("removing last file empties collection", removeFile([items[0]], items[0].id).length === 0);

// =========================================================================
// REORDERING UNIT TESTS (A-1.1 Requirements)
// =========================================================================
const baseList: WorkspaceFile[] = [
  { id: "1", file: pdf("one.pdf", 100, 10) },
  { id: "2", file: pdf("two.pdf", 200, 20) },
  { id: "3", file: pdf("three.pdf", 300, 30) },
  { id: "4", file: pdf("four.pdf", 400, 40) },
];

// 1. Moving the first file to the last position (index 0 -> 3)
const firstToLast = reorderFiles(baseList, 0, 3);
check(
  "reorderFiles: move first file to last position",
  firstToLast.length === 4 &&
    firstToLast.map((f) => f.id).join(",") === "2,3,4,1"
);

// 2. Moving the last file to the first position (index 3 -> 0)
const lastToFirst = reorderFiles(baseList, 3, 0);
check(
  "reorderFiles: move last file to first position",
  lastToFirst.length === 4 &&
    lastToFirst.map((f) => f.id).join(",") === "4,1,2,3"
);

// 3. Moving a middle file (index 1 -> 2)
const middleMoved = reorderFiles(baseList, 1, 2);
check(
  "reorderFiles: move middle file",
  middleMoved.length === 4 &&
    middleMoved.map((f) => f.id).join(",") === "1,3,2,4"
);

// 4. Moving to the same position (index 2 -> 2)
const samePos = reorderFiles(baseList, 2, 2);
check(
  "reorderFiles: move to same position unchanged",
  samePos.length === 4 &&
    samePos.map((f) => f.id).join(",") === "1,2,3,4"
);

// 5. Empty collection
const emptyReorder = reorderFiles([], 0, 1);
check("reorderFiles: empty collection safe", Array.isArray(emptyReorder) && emptyReorder.length === 0);

// Single item collection
const singleReorder = reorderFiles([baseList[0]], 0, 0);
check("reorderFiles: single file collection safe", singleReorder.length === 1 && singleReorder[0].id === "1");

// 6. Invalid indexes
const invalidFrom = reorderFiles(baseList, -1, 2);
const invalidTo = reorderFiles(baseList, 1, 99);
check(
  "reorderFiles: invalid indexes return unchanged copy",
  invalidFrom.map((f) => f.id).join(",") === "1,2,3,4" &&
    invalidTo.map((f) => f.id).join(",") === "1,2,3,4"
);

// 7. Original array immutability
const freezeOriginal = [...baseList];
const clonedResult = reorderFiles(freezeOriginal, 0, 2);
check(
  "reorderFiles: original array is immutable",
  freezeOriginal.map((f) => f.id).join(",") === "1,2,3,4" &&
    clonedResult !== freezeOriginal
);

// 8. Metadata preservation (file instance, size, lastModified)
const movedItem = firstToLast[3];
check(
  "reorderFiles: file metadata preserved",
  movedItem.id === "1" &&
    movedItem.file.name === "one.pdf" &&
    movedItem.file.size === 100 &&
    movedItem.file.lastModified === 10
);

// 9. ID-based reordering (drag-and-drop support)
const idMoveMiddle = reorderFiles(baseList, "2", "4"); // insert before "4"
check(
  "reorderFiles: ID-based move before target",
  idMoveMiddle.map((f) => f.id).join(",") === "1,3,2,4"
);

const idMoveToEnd = reorderFiles(baseList, "1", null); // move to end
check(
  "reorderFiles: ID-based move to end with null",
  idMoveToEnd.map((f) => f.id).join(",") === "2,3,4,1"
);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
