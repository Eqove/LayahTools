import * as fs from "fs";
import * as path from "path";
import { init } from "@embedpdf/pdfium";

/** PDFium render flag: draw annotations (including form widgets with an appearance stream). */
export const FPDF_ANNOT = 0x01;

export interface PageProbe {
  pageIndex: number;
  /** Page size in points as PDFium reports it (already accounts for /Rotate). */
  width: number;
  height: number;
  rotation: number;
  /** PDFium page-object counts by type. */
  objects: { text: number; path: number; image: number; shading: number; form: number; total: number };
}

export interface RegionMask {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DiffResult {
  width: number;
  height: number;
  totalPixels: number;
  differingPixels: number;
  diffPercentage: number;
  maxChannelDiff: number;
  affectedRegionDiff: number;
  unaffectedRegionDiff: number;
  passed: boolean;
}

export class VisualDiffEngine {
  private pdfium: any = null;
  private wasm: any = null;

  async initialize() {
    if (this.pdfium) return;
    const wasmPath = path.resolve(__dirname, "../../public/pdfium.wasm");
    const wasmBinary = fs.readFileSync(wasmPath);
    this.pdfium = await init({ wasmBinary });
    this.wasm = this.pdfium.pdfium || this.pdfium;
    this.pdfium.PDFiumExt_Init();
  }

  /**
   * Renders a specific page of a PDF buffer to a raw RGBA Pixel Buffer.
   */
  async renderPageToRgba(
    pdfBytes: Uint8Array,
    pageIndex: number = 0,
    width: number = 400,
    height: number = 600,
    flags: number = 0
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    await this.initialize();

    const ptr = this.wasm._malloc(pdfBytes.length);
    this.wasm.HEAPU8.set(pdfBytes, ptr);

    const doc = this.pdfium.FPDF_LoadMemDocument(ptr, pdfBytes.length, "");
    if (!doc) {
      this.wasm._free(ptr);
      throw new Error("Failed to load PDF in PDFium for rendering");
    }

    const page = this.pdfium.FPDF_LoadPage(doc, pageIndex);
    if (!page) {
      this.pdfium.FPDF_CloseDocument(doc);
      this.wasm._free(ptr);
      throw new Error(`Failed to load page index ${pageIndex}`);
    }

    // Create bitmap (0 = BGRx / BGRA)
    const bitmap = this.pdfium.FPDFBitmap_Create(width, height, 0);
    // Fill white (0xFFFFFFFF)
    this.pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    // Render page
    this.pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, flags);

    const bufPtr = this.pdfium.FPDFBitmap_GetBuffer(bitmap);
    const byteLength = width * height * 4;
    const rawBytes = new Uint8Array(this.wasm.HEAPU8.slice(bufPtr, bufPtr + byteLength));

    // Cleanup PDFium handles
    this.pdfium.FPDFBitmap_Destroy(bitmap);
    this.pdfium.FPDF_ClosePage(page);
    this.pdfium.FPDF_CloseDocument(doc);
    this.wasm._free(ptr);

    return { data: rawBytes, width, height };
  }

  /** Page size, rotation and object counts per page (read-only PDFium probe). */
  async probePages(pdfBytes: Uint8Array): Promise<PageProbe[]> {
    await this.initialize();
    const ptr = this.wasm._malloc(pdfBytes.length);
    this.wasm.HEAPU8.set(pdfBytes, ptr);
    const doc = this.pdfium.FPDF_LoadMemDocument(ptr, pdfBytes.length, "");
    if (!doc) {
      this.wasm._free(ptr);
      throw new Error("Failed to load PDF in PDFium for probing");
    }
    const out: PageProbe[] = [];
    try {
      const n = this.pdfium.FPDF_GetPageCount(doc);
      for (let i = 0; i < n; i++) {
        const page = this.pdfium.FPDF_LoadPage(doc, i);
        const objects = { text: 0, path: 0, image: 0, shading: 0, form: 0, total: 0 };
        const count = this.pdfium.FPDFPage_CountObjects(page);
        const names = [undefined, "text", "path", "image", "shading", "form"] as const;
        for (let j = 0; j < count; j++) {
          const type = this.pdfium.FPDFPageObj_GetType(this.pdfium.FPDFPage_GetObject(page, j));
          const key = names[type];
          if (key) objects[key]++;
          objects.total++;
        }
        out.push({
          pageIndex: i,
          width: Math.round(this.pdfium.FPDF_GetPageWidthF(page) * 100) / 100,
          height: Math.round(this.pdfium.FPDF_GetPageHeightF(page) * 100) / 100,
          rotation: this.pdfium.FPDFPage_GetRotation(page) * 90,
          objects,
        });
        this.pdfium.FPDF_ClosePage(page);
      }
    } finally {
      this.pdfium.FPDF_CloseDocument(doc);
      this.wasm._free(ptr);
    }
    return out;
  }

  /**
   * Compare two RGBA buffers with optional region masks.
   * Region coordinates are normalized or in pixel units: [left, top, right, bottom].
   */
  compare(
    imgA: { data: Uint8Array; width: number; height: number },
    imgB: { data: Uint8Array; width: number; height: number },
    options: {
      threshold?: number; // color difference threshold (0-255)
      maxAllowedUnaffectedDiffPercent?: number; // threshold for unaffected region
      masks?: RegionMask[];
    } = {}
  ): DiffResult {
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      throw new Error(`Dimension mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`);
    }

    const { width, height } = imgA;
    const totalPixels = width * height;
    const threshold = options.threshold ?? 5; // allow minor anti-aliasing jitter
    const maxAllowedUnaffected = options.maxAllowedUnaffectedDiffPercent ?? 0.05; // 0.05%
    const masks = options.masks ?? [];

    let differingPixels = 0;
    let maxChannelDiff = 0;
    let affectedRegionDiff = 0;
    let unaffectedRegionDiff = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const bA = imgA.data[idx];
        const gA = imgA.data[idx + 1];
        const rA = imgA.data[idx + 2];

        const bB = imgB.data[idx];
        const gB = imgB.data[idx + 1];
        const rB = imgB.data[idx + 2];

        const dR = Math.abs(rA - rB);
        const dG = Math.abs(gA - gB);
        const dB = Math.abs(bA - bB);
        const maxD = Math.max(dR, dG, dB);

        if (maxD > threshold) {
          differingPixels++;
          if (maxD > maxChannelDiff) maxChannelDiff = maxD;

          // Check if this pixel falls inside any masked region
          const inMask = masks.some(
            (m) => x >= m.left && x <= m.right && y >= m.top && y <= m.bottom
          );

          if (inMask) {
            affectedRegionDiff++;
          } else {
            unaffectedRegionDiff++;
          }
        }
      }
    }

    const diffPercentage = (differingPixels / totalPixels) * 100;
    const unaffectedDiffPercent = (unaffectedRegionDiff / totalPixels) * 100;

    // Test passes if unaffected region diff is within the allowed threshold
    const passed = unaffectedDiffPercent <= maxAllowedUnaffected;

    return {
      width,
      height,
      totalPixels,
      differingPixels,
      diffPercentage: Number(diffPercentage.toFixed(2)),
      maxChannelDiff,
      affectedRegionDiff,
      unaffectedRegionDiff,
      passed,
    };
  }
}
