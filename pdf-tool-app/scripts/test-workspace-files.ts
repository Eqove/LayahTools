import { addFiles, removeFile, replaceFile, resolveActive, type WorkspaceFile } from "../src/lib/workspace/files";

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

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
