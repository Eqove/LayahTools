import * as fs from "fs";
import { PdfEditorEngine } from "../../src/lib/pdf/editor/engine";
import type { PageText } from "../../src/lib/interpretation/types";

const wasm = () => new Uint8Array(fs.readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm")).buffer as ArrayBuffer;

/** Test-only: reads text objects per page through the PDFium engine (read-only; the engine is not modified). */
export async function loadPageTexts(pdfPath: string): Promise<PageText[]> {
  const engine = new PdfEditorEngine();
  await engine.initialize(wasm());
  await engine.load(new Uint8Array(fs.readFileSync(pdfPath)));
  try {
    const pages: PageText[] = [];
    const n = await engine.getPageCount();
    for (let i = 0; i < n; i++) {
      const info = await engine.inspectPage(i);
      const texts = await engine.getTextObjects(i);
      pages.push({
        pageIndex: i,
        width: info.width,
        height: info.height,
        items: texts.map((t) => ({ text: t.text, bounds: { ...t.bounds } })),
      });
    }
    return pages;
  } finally {
    engine.dispose();
  }
}
