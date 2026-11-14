import * as fs from "fs";
import * as path from "path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from "pdf-lib";
import { compareAnnotations, inspectAnnotations } from "../src/lib/pdf/annotations";
import { loadPdfJsNode } from "./lib/pdfjs-node";

const CORPUS = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const read = (n: string) => new Uint8Array(fs.readFileSync(path.join(CORPUS, n)));

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

/** Edits the first matching annotation on a page with `mutate`, returning new bytes. */
async function editAnnots(bytes: Uint8Array, page: number, mutate: (annots: PDFArray, doc: PDFDocument) => void) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(page).node.lookup(PDFName.of("Annots"), PDFArray);
  mutate(annots, doc);
  return doc.save({ useObjectStreams: false });
}

async function main() {
  console.log("=== A-4.4 ANNOTATION INSPECTOR ===\n");

  // 1. Manifest annotation flags must match the real files.
  console.log("--- 1. Manifest flags vs real /Annots ---");
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, "manifest.json"), "utf-8"));
  for (const f of manifest.fixtures as { name: string; expected: { hasAnnotations?: boolean; isEncrypted: boolean } }[]) {
    if (f.expected.isEncrypted) continue;
    const ins0 = await inspectAnnotations(read(f.name));
    const real = ins0.total - (ins0.byType.Widget ?? 0) > 0; // form widgets are covered by hasForms
    check(`manifest hasAnnotations (non-widget) matches ${f.name}`, real === !!f.expected.hasAnnotations, `manifest ${!!f.expected.hasAnnotations}, real ${real}`);
  }

  // 2. Inspector on the markup fixture.
  console.log("\n--- 2. annotations-markup.pdf ---");
  const markup = read("annotations-markup.pdf");
  const ins = await inspectAnnotations(markup);
  const want = { Highlight: 2, Underline: 1, StrikeOut: 1, Text: 1, Popup: 1, Ink: 1, FreeText: 1, Square: 1, Link: 1, Widget: 1 };
  check("per-type counts", JSON.stringify(Object.fromEntries(Object.entries(ins.byType).sort())) === JSON.stringify(Object.fromEntries(Object.entries(want).sort())), JSON.stringify(ins.byType));
  check("page 1 has 10 annotations, page 2 has 1", ins.pages[0].length === 10 && ins.pages[1].length === 1);
  check("no dangling references", ins.dangling === 0);
  const hl = ins.pages[0].find((a) => a.name === "hl-1")!;
  check("highlight: rect, colour, contents, 1 quad", !!hl && hl.rect![0] === 48 && hl.rect![3] === 754 && JSON.stringify(hl.color) === "[1,1,0]" && hl.contents === "important" && hl.quadPointCount === 1);
  check("highlight has an appearance stream", hl.hasAppearance);
  const note = ins.pages[0].find((a) => a.name === "note-1")!;
  check("sticky note links to its popup", note.hasPopup);
  const ink = ins.pages[0].find((a) => a.name === "ink-1")!;
  check("ink: 1 stroke path", ink.inkPathCount === 1);
  const link = ins.pages[0].find((a) => a.name === "link-1")!;
  check("link: URI captured, no appearance", link.uri === "https://example.com/" && !link.hasAppearance);
  const widget = ins.pages[0].find((a) => a.subtype === "Widget")!;
  check("widget: field name captured", widget.fieldName === "reviewer.name");

  // 3. Independent cross-check against PDF.js.
  console.log("\n--- 3. Cross-check with PDF.js getAnnotations ---");
  const pdfjs = await loadPdfJsNode();
  for (const name of ["annotations-markup.pdf", "form-all-fields.pdf", "form-acroform.pdf"]) {
    const bytes = read(name);
    const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
    const doc = await task.promise;
    const mine = await inspectAnnotations(bytes);
    let allMatch = true;
    const notes: string[] = [];
    for (let p = 0; p < doc.numPages; p++) {
      const page = await doc.getPage(p + 1);
      const theirs: { subtype: string }[] = await page.getAnnotations();
      const a = theirs.map((x) => x.subtype).sort().join(",");
      const b = mine.pages[p].map((x) => x.subtype).sort().join(",");
      if (a !== b) {
        allMatch = false;
        notes.push(`p${p + 1}: pdf.js [${a}] vs inspector [${b}]`);
      }
    }
    await task.destroy();
    check(`PDF.js and inspector agree on subtypes per page: ${name}`, allMatch, notes.join("; "));
  }

  // 4. compareAnnotations: identity and detected changes.
  console.log("\n--- 4. compareAnnotations ---");
  const same = compareAnnotations(ins, await inspectAnnotations(markup));
  check("identical file: nothing missing/added/modified", same.ok && !same.missing.length && !same.added.length && !same.modified.length);

  const removed = await inspectAnnotations(
    await editAnnots(markup, 0, (annots) => {
      for (let i = 0; i < annots.size(); i++) {
        const d = annots.lookup(i, PDFDict);
        if (d.get(PDFName.of("NM"))?.toString() === "(so-1)") return void annots.remove(i);
      }
    }),
  );
  const dRemoved = compareAnnotations(ins, removed);
  check("removed strikeout is reported missing", !dRemoved.ok && dRemoved.missing.length === 1 && dRemoved.missing[0].subtype === "StrikeOut", JSON.stringify(dRemoved.missing.map((m) => m.name)));
  check("count change reported by type", dRemoved.countsBefore.StrikeOut === 1 && dRemoved.countsAfter.StrikeOut === undefined);

  const moved = await inspectAnnotations(
    await editAnnots(markup, 0, (annots, doc) => {
      for (let i = 0; i < annots.size(); i++) {
        const d = annots.lookup(i, PDFDict);
        if (d.get(PDFName.of("NM"))?.toString() === "(hl-1)") {
          d.set(PDFName.of("Rect"), doc.context.obj([48, 700, 360, 718]));
          d.set(PDFName.of("Contents"), PDFString.of("changed"));
        }
      }
    }),
  );
  const dMoved = compareAnnotations(ins, moved);
  const fields = dMoved.modified.flatMap((m) => m.changes.map((c) => c.field)).sort();
  check("moved rect + changed contents reported as modified", dMoved.modified.length === 1 && dMoved.modified[0].name === "hl-1" && fields.join(",") === "contents,rect", fields.join(","));
  check("modified is not also missing/added", !dMoved.missing.length && !dMoved.added.length);

  const typeChanged = await inspectAnnotations(
    await editAnnots(markup, 0, (annots, doc) => {
      for (let i = 0; i < annots.size(); i++) {
        const d = annots.lookup(i, PDFDict);
        if (d.get(PDFName.of("NM"))?.toString() === "(ul-1)") d.set(PDFName.of("Subtype"), doc.context.obj("StrikeOut") as never);
      }
    }),
  );
  const dType = compareAnnotations(ins, typeChanged);
  check("changed subtype reported as modified", dType.modified.some((m) => m.name === "ul-1" && m.changes.some((c) => c.field === "subtype")));

  const flagged = await inspectAnnotations(
    await editAnnots(markup, 0, (annots) => {
      for (let i = 0; i < annots.size(); i++) {
        const d = annots.lookup(i, PDFDict);
        if (d.get(PDFName.of("NM"))?.toString() === "(ink-1)") d.set(PDFName.of("F"), PDFNumber.of(2));
      }
    }),
  );
  check("changed flags (hidden) reported as modified", compareAnnotations(ins, flagged).modified.some((m) => m.name === "ink-1" && m.changes.some((c) => c.field === "flags")));

  // Added annotation
  const added = await inspectAnnotations(await editAnnots(read("annotations-markup.pdf"), 1, () => undefined));
  check("no-op edit still compares clean", compareAnnotations(ins, added).ok);
  const dAdd = compareAnnotations(removed, ins);
  check("annotation present only after is reported added", dAdd.added.length === 1 && dAdd.added[0].name === "so-1");

  // Page maps (delete/extract/rearrange)
  const dDeleted = compareAnnotations(ins, { ...ins, pages: [ins.pages[0]], total: 10, byType: ins.byType, dangling: 0 }, { pageMap: [0, null] });
  check("page removed on purpose: its annotation is removedWithPage, not missing", dDeleted.ok && dDeleted.missing.length === 0 && dDeleted.removedWithPage.length === 1);
  const dSwap = compareAnnotations(ins, { ...ins, pages: [ins.pages[1], ins.pages[0]] }, { pageMap: [1, 0] });
  check("rearranged pages: annotations follow their page", dSwap.ok);
  const dWrongPage = compareAnnotations(ins, { ...ins, pages: [ins.pages[1], ins.pages[0]] });
  check("annotations on the wrong page are not hidden", !dWrongPage.ok);

  // 5. Edge cases.
  console.log("\n--- 5. Edge cases ---");
  const none = await inspectAnnotations(read("simple-text.pdf"));
  check("PDF without annotations: total 0, one empty array per page", none.total === 0 && none.pages.length === 2 && none.pages.every((p) => p.length === 0));
  let threw = false;
  try {
    await inspectAnnotations(new Uint8Array([1, 2, 3, 4]));
  } catch {
    threw = true;
  }
  check("corrupt bytes throw instead of returning an empty result", threw);
  threw = false;
  try {
    await inspectAnnotations(read("password-protected.pdf"));
  } catch {
    threw = true;
  }
  check("encrypted PDF throws instead of reporting zero annotations", threw);

  const dangling = await inspectAnnotations(
    await editAnnots(markup, 0, (annots, doc) => {
      annots.push(doc.context.register(doc.context.obj({})) && (doc.context.obj(null) as never));
    }),
  );
  check("a non-dictionary /Annots entry is counted as dangling, not ignored", dangling.dangling === 1, `dangling ${dangling.dangling}`);

  console.log(`\n=================================================`);
  console.log(failed ? `${failed} ANNOTATION TESTS FAILED` : "ALL ANNOTATION TESTS PASSED");
  console.log(`=================================================\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
