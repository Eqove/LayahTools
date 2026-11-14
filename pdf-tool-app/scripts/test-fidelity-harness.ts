import * as fs from "fs";
import * as path from "path";
import { PDFDocument, PDFName } from "pdf-lib";
import { addsObjects, compareSnapshots, formatReport, rotatedBy, snapshotPdf, visiblyChanged } from "./lib/fidelity";
import { rearrangePdf, redactPdf } from "../src/lib/pdf/operations";
import { deleteSinglePage, rotateSinglePage } from "../src/lib/pdf/page-actions";

/**
 * A-4.1: tests of the affected/unaffected comparison itself. Positive cases use real operations on corpus fixtures;
 * negative cases doctor the output and the harness must FAIL with a specific explanation.
 */
const CORPUS = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const bytesOf = (n: string) => new Uint8Array(fs.readFileSync(path.join(CORPUS, n)));
const fileOf = (n: string) => new File([bytesOf(n) as BlobPart], n, { type: "application/pdf" });

const fileBytes = async (f: File) => new Uint8Array(await f.arrayBuffer());

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

async function main() {
  console.log("=== A-4.1 FIDELITY COMPARISON HARNESS ===\n");
  const fixture = "multi-column.pdf";
  const before = await snapshotPdf(bytesOf(fixture));
  check("snapshot: 3 pages with text, objects, size and a render each", before.pageCount === 3 && before.pages.every((p) => p.textChars > 0 && p.objects.total > 0 && p.render.data.length > 0 && p.width > 0));

  // --- positive cases ---
  console.log("\n--- Positive: real operations ---");
  const identity = compareSnapshots(before, await snapshotPdf(bytesOf(fixture)), { fixture, operation: "no-op copy", affectedPages: [] });
  check("identical copy: PASS, nothing affected, all pages unaffected", identity.pass && identity.affected.pages.length === 0 && identity.unaffected.pages.length === 3, identity.failures.join("; "));

  const rotated = await fileBytes(await rotateSinglePage(fileOf(fixture), 1, 90));
  const rRot = compareSnapshots(before, await snapshotPdf(rotated), { fixture, operation: "rotate page 2 by 90", affectedPages: [1], expectAffected: rotatedBy(90) });
  check("rotate page 2: affected [2] PASS, unaffected [1,3] PASS", rRot.pass && rRot.affected.pass && rRot.unaffected.pass && rRot.affected.pages.join() === "1" && rRot.unaffected.pages.join() === "0,2", rRot.failures.join("; "));

  const redacted = (await redactPdf(fileOf(fixture), [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }]))[0].bytes;
  const rRed = compareSnapshots(before, await snapshotPdf(redacted), { fixture, operation: "draw rectangle on page 1", affectedPages: [0], expectAffected: addsObjects({ path: 1 }) });
  check("rectangle on page 1: affected PASS, other pages unchanged", rRed.pass, rRed.failures.join("; "));
  const pr = rRed.affected.results[0];
  check("affected result carries before/after numbers", pr.metrics.pathBefore !== undefined && pr.metrics.pathAfter === pr.metrics.pathBefore + 1 && (pr.metrics.pixelsChanged ?? 0) > 0, JSON.stringify(pr.metrics));

  const deleted = await fileBytes(await deleteSinglePage(fileOf(fixture), 1));
  const rDel = compareSnapshots(before, await snapshotPdf(deleted), { fixture, operation: "delete page 2", affectedPages: [], pageMap: [0, null, 1] });
  check("delete page 2 with pageMap: remaining pages unaffected PASS, page count 3 -> 2", rDel.pass && rDel.pageCountAfter === 2 && rDel.expectedPageCount === 2, rDel.failures.join("; "));

  const reordered = (await rearrangePdf(fileOf(fixture), [2, 0, 1]))[0].bytes;
  const rRe = compareSnapshots(before, await snapshotPdf(reordered), { fixture, operation: "rearrange 3,1,2", affectedPages: [], pageMap: [1, 2, 0] });
  check("rearrange with pageMap: every page found at its new position", rRe.pass, rRe.failures.join("; "));

  // --- negative cases ---
  console.log("\n--- Negative: the harness must catch these ---");
  const nNoChange = compareSnapshots(before, await snapshotPdf(bytesOf(fixture)), { fixture, operation: "claimed rotate", affectedPages: [1], expectAffected: rotatedBy(90) });
  check("claimed change that did not happen -> FAIL on the affected page", !nNoChange.pass && !nNoChange.affected.pass && nNoChange.unaffected.pass && /rotation/.test(nNoChange.failures.join(" ")), nNoChange.failures.join("; "));

  const rectOnOther = (await redactPdf(fileOf(fixture), [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }]))[0].bytes;
  const nCollateral = compareSnapshots(before, await snapshotPdf(rectOnOther), { fixture, operation: "claimed rotate of page 2 (but drew on page 1)", affectedPages: [1], expectAffected: visiblyChanged() });
  check("unexpected change on an unaffected page -> FAIL naming the page and the object count", !nCollateral.pass && !nCollateral.unaffected.pass && /page 1/.test(nCollateral.failures.join(" ")) && /objects/.test(nCollateral.failures.join(" ")), nCollateral.failures.join("; "));
  check("unexpected pixel change is reported too", nCollateral.unaffected.results.find((r) => r.sourcePage === 0)!.notes.some((n) => /pixel/.test(n)));

  const nDropped = compareSnapshots(before, await snapshotPdf(deleted), { fixture, operation: "claimed no-op (but a page vanished)", affectedPages: [] });
  check("dropped page with identity map -> FAIL on page count", !nDropped.pass && /page count/.test(nDropped.failures.join(" ")), nDropped.failures.join("; "));

  const nSwapped = compareSnapshots(before, await snapshotPdf(reordered), { fixture, operation: "claimed no-op (but pages were reordered)", affectedPages: [] });
  check("reordered pages with identity map -> FAIL (text and render differ)", !nSwapped.pass && /text/.test(nSwapped.failures.join(" ")), nSwapped.failures.join("; "));

  const nExtra = compareSnapshots(before, await snapshotPdf(await (async () => {
    const d = await PDFDocument.load(bytesOf(fixture));
    d.addPage([595, 842]);
    return d.save();
  })()), { fixture, operation: "claimed no-op (but a page was appended)", affectedPages: [] });
  check("unexpected extra page -> FAIL", !nExtra.pass && /page count|extra page/.test(nExtra.failures.join(" ")), nExtra.failures.join("; "));

  // Annotation loss on an unaffected page.
  const annFixture = "annotations-markup.pdf";
  const annBefore = await snapshotPdf(bytesOf(annFixture));
  const stripped = await (async () => {
    const d = await PDFDocument.load(bytesOf(annFixture));
    d.getPage(1).node.delete(PDFName.of("Annots"));
    return d.save();
  })();
  const nAnnot = compareSnapshots(annBefore, await snapshotPdf(stripped), { fixture: annFixture, operation: "claimed edit of page 1 (but page 2 lost its highlight)", affectedPages: [0], expectAffected: visiblyChanged() });
  check("annotation lost on an unaffected page -> FAIL naming the annotation", !nAnnot.pass && /Highlight/.test(nAnnot.failures.join(" ")) && /missing/.test(nAnnot.failures.join(" ")), nAnnot.failures.join("; "));

  // A spec that names affected pages but no expectation is a harness misuse, not a silent pass.
  let threw = false;
  try {
    compareSnapshots(before, before, { fixture, operation: "x", affectedPages: [0] });
  } catch {
    threw = true;
  }
  check("affected pages without an expectation throw (intended change must be verified)", threw);

  // --- report ---
  console.log("\n--- Report ---");
  const text = formatReport(nCollateral);
  for (const needle of ["multi-column.pdf", "claimed rotate of page 2", "Affected", "Unaffected", "FAIL", "page 1"]) check(`report mentions "${needle}"`, text.includes(needle));
  const okText = formatReport(rRot);
  check("passing report says OVERALL PASS with page lists", /OVERALL: PASS/.test(okText) && /Affected pages: 2/.test(okText) && /Unaffected pages: 1, 3/.test(okText), okText.split("\n").slice(0, 6).join(" | "));

  console.log(`\n=================================================`);
  console.log(failed ? `${failed} FIDELITY HARNESS TESTS FAILED` : "ALL FIDELITY HARNESS TESTS PASSED");
  console.log(`=================================================\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
