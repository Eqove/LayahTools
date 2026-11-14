import * as fs from "fs";
import * as zlib from "zlib";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  analyzeTextLayer,
  applyOcrStatus,
  classifyPage,
  ocrProgress,
  pageStatusView,
  pagesToOcr,
  summarizeTextLayer,
  TextLayerAnalysisError,
  type PageTextStats,
} from "../src/lib/interpretation/text-layer";
import { overlayOcrText, OcrError, type OcrPageStatus, type OcrRecognizer } from "../src/lib/pdf/ocr-overlay";
import { loadPdfJsNode } from "./lib/pdfjs-node";
import { loadPageTextsFromBytes } from "./lib/pdf-text-pages";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
}
const CORPUS = "tests/fixtures/pdf-corpus/";
const fx = (n: string) => new Uint8Array(fs.readFileSync(CORPUS + n));
const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
const st = (pageIndex: number, alnumChars: number, imageCoverage: number): PageTextStats => ({ pageIndex, alnumChars, imageCoverage });

// ---- opaque PNG (no alpha, so PDF.js paints it) ----
function crc32(buf: Buffer) {
  let c: number;
  let crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(t: string, d: Buffer) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}
function solidPng(w: number, h: number, gray: number) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, gray)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** text page / scanned page (full-page opaque image, no text) / scanned page with a text layer on top */
async function buildMixedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const img = await doc.embedPng(solidPng(8, 8, 200));
  const p0 = doc.addPage([595, 842]);
  p0.drawText("A normal text page with enough words to count as a text layer.", { x: 50, y: 780, size: 12, font });
  const p1 = doc.addPage([595, 842]);
  p1.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  const p2 = doc.addPage([595, 842]);
  p2.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  p2.drawText("This scanned page already carries a recognised text layer, so it holds both a page image and text.", { x: 50, y: 780, size: 10, font });
  return doc.save();
}

// =============== 1. classifyPage (pure) ===============
{
  const c = (n: number, cov: number) => classifyPage(st(0, n, cov));
  check("text only -> TEXT_AVAILABLE", c(500, 0).status === "TEXT_AVAILABLE");
  check("short text only ('Chapter 1') -> TEXT_AVAILABLE", c(8, 0).status === "TEXT_AVAILABLE");
  check("no text, no image -> SCANNED_PAGE flagged blank", c(0, 0).status === "SCANNED_PAGE" && c(0, 0).blank === true);
  check("no text, full-page image -> SCANNED_PAGE, not blank", c(0, 1).status === "SCANNED_PAGE" && c(0, 1).blank === false);
  check("no text, partial image (40%) -> SCANNED_PAGE, not blank", c(0, 0.4).status === "SCANNED_PAGE" && c(0, 0.4).blank === false);
  check("full-page image + a page-number stamp (6 chars) -> still SCANNED_PAGE", c(6, 1).status === "SCANNED_PAGE");
  check("full-page image + real text layer (120 chars) -> MIXED_CONTENT", c(120, 0.95).status === "MIXED_CONTENT");
  check("text + small figure (15%) -> TEXT_AVAILABLE", c(900, 0.15).status === "TEXT_AVAILABLE");
  check("text + big figure (60%) is not a scan", c(900, 0.6).status === "TEXT_AVAILABLE");
  check("boundary: 2 chars no image -> SCANNED_PAGE, 3 chars -> TEXT_AVAILABLE", c(2, 0).status === "SCANNED_PAGE" && c(3, 0).status === "TEXT_AVAILABLE");
  check("boundary: 49 chars on a full-page image -> SCANNED_PAGE, 50 -> MIXED_CONTENT", c(49, 1).status === "SCANNED_PAGE" && c(50, 1).status === "MIXED_CONTENT");
  check("malformed stats (NaN, negative, missing) are treated as 0", classifyPage({ pageIndex: 3, alnumChars: NaN, imageCoverage: -2 }).status === "SCANNED_PAGE" && classifyPage({ pageIndex: 3 } as PageTextStats).status === "SCANNED_PAGE");
  check("coverage above 1 is clamped", classifyPage(st(0, 0, 7)).imageCoverage === 1);
  check("options override thresholds", classifyPage(st(0, 10, 0), { minTextChars: 20 }).status === "SCANNED_PAGE");
}

// =============== 2. summarizeTextLayer (pure) ===============
{
  const empty = summarizeTextLayer([]);
  check("empty document: kind EMPTY, no OCR needed, no text layer", empty.kind === "EMPTY" && !empty.needsOcr && !empty.hasTextLayer && empty.pageCount === 0);
  check("non-array input behaves as empty", summarizeTextLayer(undefined as unknown as PageTextStats[]).kind === "EMPTY");
  const text = summarizeTextLayer([st(0, 400, 0), st(1, 300, 0.1)]);
  check("all text pages: kind TEXT, hasTextLayer, no OCR", text.kind === "TEXT" && text.hasTextLayer && !text.needsOcr && text.scannedPages.length === 0);
  const scan = summarizeTextLayer([st(0, 0, 1), st(1, 0, 1)]);
  check("all scanned: kind SCANNED, no text layer, OCR needed on every page", scan.kind === "SCANNED" && !scan.hasTextLayer && scan.needsOcr && JSON.stringify(scan.scannedPages) === "[0,1]");
  const mixed = summarizeTextLayer([st(0, 400, 0), st(1, 0, 1), st(2, 400, 0), st(3, 0, 0.9), st(4, 150, 1)]);
  check("mixed document: kind MIXED with exact page sets", mixed.kind === "MIXED" && JSON.stringify(mixed.scannedPages) === "[1,3]" && JSON.stringify(mixed.textPages) === "[0,2]" && JSON.stringify(mixed.mixedPages) === "[4]" && mixed.needsOcr);
  check("hasTextLayer is true when any page has text", mixed.hasTextLayer);
  check("page order is by pageIndex regardless of input order", JSON.stringify(summarizeTextLayer([st(2, 0, 1), st(0, 400, 0), st(1, 400, 0)]).pages.map((p) => p.pageIndex)) === "[0,1,2]");
  check("deterministic", JSON.stringify(summarizeTextLayer([st(1, 0, 1), st(0, 9, 0)])) === JSON.stringify(summarizeTextLayer([st(1, 0, 1), st(0, 9, 0)])));
  check("only MIXED_CONTENT pages: no OCR required", !summarizeTextLayer([st(0, 200, 1)]).needsOcr);
}

// =============== 3. OCR target selection and status model (pure) ===============
{
  const s = summarizeTextLayer([st(0, 400, 0), st(1, 0, 1), st(2, 150, 1), st(3, 0, 0)]);
  check("pagesToOcr(scanned) = scanned pages only", JSON.stringify(pagesToOcr(s, "scanned")) === "[1,3]");
  check("pagesToOcr(all) = every page", JSON.stringify(pagesToOcr(s, "all")) === "[0,1,2,3]");
  check("pagesToOcr without analysis -> undefined (OCR everything)", pagesToOcr(null, "scanned") === undefined && pagesToOcr(undefined, "all") === undefined);
  check("pagesToOcr on a text-only document in 'scanned' mode -> []", pagesToOcr(summarizeTextLayer([st(0, 400, 0)]), "scanned")!.length === 0);

  let m = applyOcrStatus({}, 1, "OCR_PROCESSING");
  const before = JSON.stringify(m);
  const m2 = applyOcrStatus(m, 1, "OCR_COMPLETED");
  check("status reducer is immutable", JSON.stringify(m) === before && m2[1] === "OCR_COMPLETED" && m[1] === "OCR_PROCESSING");
  m = applyOcrStatus(applyOcrStatus(m2, 3, "OCR_PROCESSING"), 3, "OCR_FAILED");
  const view = pageStatusView(s, m);
  check("view shows OCR status over the analysis status", view[1].status === "OCR_COMPLETED" && view[3].status === "OCR_FAILED" && view[1].base === "SCANNED_PAGE");
  check("view keeps analysis status for untouched pages", view[0].status === "TEXT_AVAILABLE" && view[2].status === "MIXED_CONTENT");
  const p = ocrProgress(m, [1, 3]);
  check("progress counts finished and failed targets", p.total === 2 && p.done === 2 && p.failed === 1 && p.processing === 0);
  check("progress for an in-flight page", ocrProgress({ 1: "OCR_PROCESSING" }, [1, 3]).processing === 1 && ocrProgress({ 1: "OCR_PROCESSING" }, [1, 3]).done === 0);
  check("progress with no targets is zero", ocrProgress({}, []).total === 0);
}

// =============== 4. PDF.js adapter on real and generated PDFs ===============
async function adapterTests(pdfjsRoot: string | undefined) {
  const pdfjs = await loadPdfJsNode(pdfjsRoot);
  const label = `pdf.js ${pdfjs.version}`;
  const manifest = JSON.parse(fs.readFileSync(CORPUS + "manifest.json", "utf-8")) as { fixtures: { name: string; pageCount: number; expected: { hasTextLayer: boolean; isEncrypted: boolean } }[] };

  for (const f of manifest.fixtures.filter((x) => !x.expected.isEncrypted)) {
    const sum = await analyzeTextLayer(fx(f.name), pdfjs);
    check(`[${label}] ${f.name}: page count and hasTextLayer match the manifest`, sum.pageCount === f.pageCount && sum.hasTextLayer === f.expected.hasTextLayer, `${sum.pageCount} pages, kind ${sum.kind}`);
  }
  const scanned = await analyzeTextLayer(fx("scanned-image-only.pdf"), pdfjs);
  check(`[${label}] scanned-image-only.pdf: SCANNED_PAGE, OCR recommended`, scanned.kind === "SCANNED" && scanned.needsOcr && JSON.stringify(scanned.scannedPages) === "[0]");
  const simple = await analyzeTextLayer(fx("simple-text.pdf"), pdfjs);
  check(`[${label}] simple-text.pdf: text pages, small image does not make it a scan`, simple.kind === "TEXT" && simple.pages.every((p) => p.status === "TEXT_AVAILABLE") && simple.pages[0].imageCoverage > 0 && simple.pages[0].imageCoverage < 0.05, `coverage ${simple.pages[0].imageCoverage}`);
  const heavy = await analyzeTextLayer(fx("image-heavy.pdf"), pdfjs);
  check(`[${label}] image-heavy.pdf (6 pages with figures and text): all TEXT_AVAILABLE`, heavy.pageCount === 6 && heavy.kind === "TEXT" && heavy.pages.some((p) => p.imageCoverage > 0.3));
  const rotated = await analyzeTextLayer(fx("rotated-pages.pdf"), pdfjs);
  check(`[${label}] rotated-pages.pdf: rotation does not disturb detection`, rotated.pageCount === 3 && rotated.kind === "TEXT");
  const long = await analyzeTextLayer(fx("long-document.pdf"), pdfjs);
  check(`[${label}] long-document.pdf: 25 pages, all text`, long.pageCount === 25 && long.kind === "TEXT");

  const mixedBytes = await buildMixedPdf();
  const mixed = await analyzeTextLayer(mixedBytes, pdfjs);
  check(`[${label}] generated mixed PDF: TEXT / SCANNED / MIXED_CONTENT per page`, JSON.stringify(mixed.pages.map((p) => p.status)) === '["TEXT_AVAILABLE","SCANNED_PAGE","MIXED_CONTENT"]', JSON.stringify(mixed.pages.map((p) => [p.status, p.alnumChars, p.imageCoverage])));
  check(`[${label}] generated mixed PDF: full-page image measured as ~100% coverage`, mixed.pages[1].imageCoverage > 0.95 && mixed.pages[1].imageCoverage <= 1 && mixed.pages[0].imageCoverage === 0);
  check(`[${label}] generated mixed PDF: document kind MIXED, OCR only for the scan`, mixed.kind === "MIXED" && JSON.stringify(mixed.scannedPages) === "[1]" && JSON.stringify(pagesToOcr(mixed, "scanned")) === "[1]");
  check(`[${label}] generated mixed PDF: text layer counted from the real text`, mixed.pages[0].alnumChars > 30 && mixed.pages[1].alnumChars === 0 && mixed.pages[2].alnumChars > 50);

  const before = mixedBytes.byteLength;
  const copyHash = sha(mixedBytes);
  await analyzeTextLayer(mixedBytes, pdfjs);
  check(`[${label}] input bytes are not detached or changed`, mixedBytes.byteLength === before && sha(mixedBytes) === copyHash);
  check(`[${label}] deterministic`, JSON.stringify(await analyzeTextLayer(mixedBytes, pdfjs)) === JSON.stringify(mixed));

  const progress: [number, number][] = [];
  await analyzeTextLayer(mixedBytes, pdfjs, { onProgress: (d, t) => progress.push([d, t]) });
  check(`[${label}] progress is reported per page`, JSON.stringify(progress) === "[[1,3],[2,3],[3,3]]", JSON.stringify(progress));

  const errOf = async (bytes: Uint8Array) => {
    try {
      await analyzeTextLayer(bytes, pdfjs);
      return null;
    } catch (e) {
      return e;
    }
  };
  const enc = await errOf(fx("password-protected.pdf"));
  check(`[${label}] encrypted PDF -> TextLayerAnalysisError mentioning the password`, enc instanceof TextLayerAnalysisError && /password/i.test(enc.message), enc instanceof Error ? enc.message : "no error");
  const garbage = await errOf(new TextEncoder().encode("this is not a pdf at all"));
  check(`[${label}] garbage bytes -> TextLayerAnalysisError`, garbage instanceof TextLayerAnalysisError && garbage.message.length > 10, garbage instanceof Error ? garbage.message : "no error");
  const none = await errOf(new Uint8Array(0));
  check(`[${label}] empty bytes -> TextLayerAnalysisError`, none instanceof TextLayerAnalysisError);
}

// =============== 5. OCR overlay core (recognizer injected; Tesseract itself only runs in the browser) ===============
async function overlayTests() {
  const words = (page: number): ReturnType<OcrRecognizer> =>
    Promise.resolve({
      imageWidth: 1190, // a 2x render of a 595pt page
      imageHeight: 1684,
      words: [
        { text: `Invoice${page}`, bbox: { x0: 100, y0: 200, x1: 300, y1: 240 } },
        { text: "Total", bbox: { x0: 100, y0: 300, x1: 200, y1: 340 } },
        { text: "  ", bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
      ],
    });

  // single scanned page, original untouched
  {
    const src = fx("scanned-image-only.pdf");
    const hash = sha(src);
    const events: string[] = [];
    const { bytes, reports } = await overlayOcrText(src, words, { onPageStatus: (p, s) => events.push(`${p}:${s}`) });
    check("overlay: original bytes are never modified", sha(src) === hash);
    check("overlay: output is a different, valid PDF with the same page count", sha(bytes) !== hash && (await PDFDocument.load(bytes)).getPageCount() === 1);
    check("overlay: events run PROCESSING then COMPLETED", JSON.stringify(events) === '["0:OCR_PROCESSING","0:OCR_COMPLETED"]', JSON.stringify(events));
    check("overlay: report counts drawn words and ignores blank ones", reports[0].status === "OCR_COMPLETED" && reports[0].words === 2 && reports[0].skippedWords === 0);
    const txt = (await loadPageTextsFromBytes(bytes))[0].items.map((i) => i.text.trim());
    check("overlay: recognised words are extractable text afterwards (PDFium)", txt.includes("Invoice0") && txt.includes("Total"), JSON.stringify(txt));
    const t = (await loadPageTextsFromBytes(bytes))[0].items.find((i) => i.text.includes("Invoice0"))!;
    check("overlay: word placed at the scaled position (x=50pt, top-down y mapped to PDF space)", Math.abs(t.bounds.left - 50) < 2 && t.bounds.bottom > 842 - 130 && t.bounds.top < 842 - 90, JSON.stringify(t.bounds));
  }

  // only selected pages of a mixed document
  {
    const src = await buildMixedPdf();
    const { bytes, reports } = await overlayOcrText(src, words, { pages: [1] });
    const pages = await loadPageTextsFromBytes(bytes);
    check("overlay: only the selected page gets recognised text", pages[1].items.some((i) => i.text.includes("Invoice1")) && !pages[0].items.some((i) => i.text.includes("Invoice")) && !pages[2].items.some((i) => i.text.includes("Invoice")));
    check("overlay: only selected pages are reported", reports.length === 1 && reports[0].pageIndex === 1);
    check("overlay: existing text of other pages is untouched", pages[0].items.some((i) => i.text.includes("A normal text page")) && pages[2].items.some((i) => i.text.includes("recognised text layer")));
    const all = await overlayOcrText(src, words, {});
    check("overlay: default is every page", all.reports.length === 3 && all.reports.every((r) => r.status === "OCR_COMPLETED"));
  }

  // partial failure
  {
    const src = await buildMixedPdf();
    const flaky: OcrRecognizer = (i) => (i === 2 ? Promise.reject(new Error("worker crashed")) : words(i));
    const statuses: Record<number, OcrPageStatus[]> = {};
    const { reports } = await overlayOcrText(src, flaky, { onPageStatus: (p, s) => (statuses[p] = [...(statuses[p] ?? []), s]) });
    check("overlay: a failing page is OCR_FAILED with its message, others complete", reports[2].status === "OCR_FAILED" && /worker crashed/.test(reports[2].error ?? "") && reports[0].status === "OCR_COMPLETED" && reports[1].status === "OCR_COMPLETED");
    check("overlay: failing page still reported PROCESSING first", JSON.stringify(statuses[2]) === '["OCR_PROCESSING","OCR_FAILED"]');
  }

  // total failure
  {
    const src = fx("simple-text.pdf");
    let err: unknown = null;
    try {
      await overlayOcrText(src, () => Promise.reject(new Error("no canvas")), {});
    } catch (e) {
      err = e;
    }
    check("overlay: all pages failing throws OcrError with a meaningful message", err instanceof OcrError && /no canvas/.test(err.message) && /all 2 page/.test(err.message) && err.reports.length === 2, err instanceof Error ? err.message : "no error");
  }

  // empty recognition
  {
    const { reports } = await overlayOcrText(fx("scanned-image-only.pdf"), () => Promise.resolve({ words: [], imageWidth: 1190, imageHeight: 1684 }), {});
    check("overlay: a page with no recognised words completes with words=0", reports[0].status === "OCR_COMPLETED" && reports[0].words === 0);
  }

  // rotated pages are refused instead of mis-placing text
  {
    const { reports } = await overlayOcrText(fx("rotated-pages.pdf"), words, {});
    check("overlay: rotated pages fail clearly, unrotated page completes", reports[0].status === "OCR_COMPLETED" && reports[1].status === "OCR_FAILED" && reports[2].status === "OCR_FAILED" && /rotated/i.test(reports[1].error ?? ""), JSON.stringify(reports.map((r) => r.status)));
  }

  // unencodable / malformed words
  {
    const odd: OcrRecognizer = () =>
      Promise.resolve({
        imageWidth: 1190,
        imageHeight: 1684,
        words: [
          { text: "日本語", bbox: { x0: 100, y0: 200, x1: 300, y1: 240 } },
          { text: "Valid", bbox: { x0: 100, y0: 300, x1: 200, y1: 340 } },
          { text: "NaNbox", bbox: { x0: NaN, y0: 1, x1: 2, y1: 3 } },
          { text: "Flipped", bbox: { x0: 300, y0: 400, x1: 100, y1: 380 } },
        ],
      });
    const { reports, bytes } = await overlayOcrText(fx("scanned-image-only.pdf"), odd, {});
    const txt = (await loadPageTextsFromBytes(bytes))[0].items.map((i) => i.text.trim());
    check("overlay: unencodable and malformed words are skipped, valid words kept", reports[0].status === "OCR_COMPLETED" && reports[0].words === 2 && reports[0].skippedWords === 2 && txt.includes("Valid") && txt.includes("Flipped") && !txt.includes("NaNbox"), JSON.stringify({ r: reports[0], txt }));
  }

  // invalid requests and sources
  {
    const rej = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (e) {
        return e;
      }
    };
    const src = fx("simple-text.pdf");
    check("overlay: out-of-range page -> OcrError", (await rej(() => overlayOcrText(src, words, { pages: [5] }))) instanceof OcrError);
    check("overlay: negative / fractional page -> OcrError", (await rej(() => overlayOcrText(src, words, { pages: [-1] }))) instanceof OcrError && (await rej(() => overlayOcrText(src, words, { pages: [0.5] }))) instanceof OcrError);
    const none = await rej(() => overlayOcrText(src, words, { pages: [] }));
    check("overlay: empty selection -> OcrError saying nothing was selected", none instanceof OcrError && /no pages/i.test(none.message));
    const bad = await rej(() => overlayOcrText(new TextEncoder().encode("nope"), words, {}));
    check("overlay: unreadable PDF -> OcrError('could not open')", bad instanceof OcrError && /could not open/i.test(bad.message), bad instanceof Error ? bad.message : "");
    const enc = await rej(() => overlayOcrText(fx("password-protected.pdf"), words, {}));
    check("overlay: encrypted PDF -> OcrError", enc instanceof OcrError);
    const dup = await overlayOcrText(src, words, { pages: [1, 0, 1] });
    check("overlay: duplicate / unordered selection is processed once, in page order", JSON.stringify(dup.reports.map((r) => r.pageIndex)) === "[0,1]");
    const a = await overlayOcrText(src, words, { pages: [0] });
    const b = await overlayOcrText(src, words, { pages: [0] });
    check("overlay: deterministic reports", JSON.stringify(a.reports) === JSON.stringify(b.reports));
  }
}

async function main() {
  const root = process.argv[2];
  await adapterTests(root);
  if (!root) {
    await overlayTests();
    // the browser uses react-pdf's own pdfjs-dist; run the adapter against that exact version too (separate process:
    // pdf.js keeps its worker on globalThis, so two versions cannot share one process)
    const nested = "node_modules/react-pdf/node_modules/pdfjs-dist";
    if (fs.existsSync(nested)) {
      console.log(`\n--- adapter against ${nested} (child process) ---`);
      const r = spawnSync(process.execPath, ["--import", "tsx", __filename, nested], { stdio: "inherit" });
      check("adapter also passes against react-pdf's bundled pdfjs-dist", r.status === 0, `exit ${r.status}`);
    } else {
      check("react-pdf bundled pdfjs-dist found", false, nested);
    }
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL TEXT-LAYER / OCR-FLOW TESTS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
