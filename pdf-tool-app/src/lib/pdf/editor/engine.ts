import { init } from "@embedpdf/pdfium";
import type { 
  PdfPageInfo, 
  PdfTextObject, 
  PdfImageObject, 
  PdfPageObject, 
  PdfTransform, 
  PdfTextOptions,
  PdfImageOptions,
  PdfRectOptions, PdfShapeOptions, PdfShapeObject
} from "./types";
import type { EditorEngine } from "./engine-contract";
import { EngineError } from "./errors";

/**
 * A high-level abstraction over the PDFium WASM engine for deep visual PDF edits.
 * Designed to cleanly encapsulate all raw pointer, malloc/free, and C-struct logic.
 */
const SHAPE_MARK = "LayahShape";
const SHAPE_KINDS: PdfShapeOptions["kind"][] = ["rect", "ellipse", "line", "arrow"];

export class PdfEditorEngine implements EditorEngine {
  private pdfium: any = null;
  private wasm: any = null;
  
  private docPtr: number | null = null;
  private docBufferPtr: number | null = null;
  
  private pages = new Map<number, number>(); // pageIndex -> pagePtr

  /**
   * Initializes the PDFium WASM engine.
   * Can be passed a wasmBinary ArrayBuffer (useful for Node testing).
   * In browser, it will default to fetching from CDN if no binary is provided.
   */
  async initialize(wasmBinary?: ArrayBuffer): Promise<void> {
    if (this.pdfium) return;

    try {
      if (wasmBinary) {
        this.pdfium = await init({ wasmBinary });
      } else {
        // Same-origin copy (public/pdfium.wasm, copied from node_modules by the predev/prebuild script)
        const response = await fetch("/pdfium.wasm");
        if (!response.ok) throw new Error(`pdfium.wasm not found (${response.status})`);
        const buffer = await response.arrayBuffer();
        this.pdfium = await init({ wasmBinary: buffer });
      }

      this.wasm = this.pdfium.pdfium || this.pdfium;
      this.pdfium.PDFiumExt_Init();
    } catch (error) {
      throw new Error(`Failed to initialize PDFium engine: ${error}`);
    }
  }

  /**
   * Loads a PDF document into memory.
   * Disposes of any previously loaded document.
   */
  async load(pdfBytes: Uint8Array): Promise<void> {
    this.ensureInitialized();
    this.cleanupDocument(); // Ensure we don't leak if loaded twice

    this.docBufferPtr = this.wasm._malloc(pdfBytes.length);
    if (!this.docBufferPtr) {
      throw new Error("Failed to allocate memory for PDF document");
    }

    this.wasm.HEAPU8.set(pdfBytes, this.docBufferPtr);
    this.docPtr = this.pdfium.FPDF_LoadMemDocument(this.docBufferPtr, pdfBytes.length, "");
    
    if (!this.docPtr) {
      const code = this.pdfium.FPDF_GetLastError?.();
      this.cleanupDocument();
      // FPDF_ERR_PASSWORD = 4
      throw code === 4
        ? new EngineError("password", "This PDF is password-protected. Unlock it before editing.")
        : new EngineError("format", "This PDF could not be opened for editing (it may be damaged or unsupported).");
    }
  }

  async getPageCount(): Promise<number> {
    this.ensureDocument();
    return this.pdfium.FPDF_GetPageCount(this.docPtr);
  }

  /**
   * Inspects basic information about a specific page.
   */
  async inspectPage(pageIndex: number): Promise<PdfPageInfo> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);

    const width = this.pdfium.FPDF_GetPageWidth(page);
    const height = this.pdfium.FPDF_GetPageHeight(page);
    const objectCount = this.pdfium.FPDFPage_CountObjects(page);
    const rotation = this.pdfium.FPDFPage_GetRotation(page) * 90;

    return {
      pageIndex,
      width,
      height,
      objectCount,
      rotation
    };
  }

  /**
   * Retrieves all text objects on a specific page.
   */
  async getTextObjects(pageIndex: number): Promise<PdfTextObject[]> {
    return this.getObjectsByType(pageIndex, [1]) as Promise<PdfTextObject[]>;
  }

  /**
   * Retrieves all image objects on a specific page.
   */
  async getImageObjects(pageIndex: number): Promise<PdfImageObject[]> {
    return this.getObjectsByType(pageIndex, [3]) as Promise<PdfImageObject[]>;
  }

  /** Fill colour [r,g,b] of an object, or null if unavailable. */
  getFillColor(objectId: string): [number, number, number] | null {
    this.ensureDocument();
    const obj = this.parseObjectId(objectId);
    const p = this.wasm._malloc(16);
    try {
      if (!this.pdfium.FPDFPageObj_GetFillColor(obj, p, p + 4, p + 8, p + 12)) return null;
      return [this.wasm.getValue(p, "i32"), this.wasm.getValue(p + 4, "i32"), this.wasm.getValue(p + 8, "i32")];
    } finally {
      this.wasm._free(p);
    }
  }

  /** Recolours an existing object's fill; font and geometry are untouched. */
  async setFillColor(pageIndex: number, objectId: string, color: [number, number, number]): Promise<void> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const obj = this.parseObjectId(objectId);
    if (!this.pdfium.FPDFPageObj_SetFillColor(obj, color[0], color[1], color[2], 255)) throw new Error(`Failed to recolour object ${objectId}`);
    this.pdfium.FPDFPage_GenerateContent(page);
  }

  /**
   * Retrieves every text and image object on a page. IDs are transient pointers
   * valid only until the next load()/dispose().
   */
  async getEditableObjects(pageIndex: number): Promise<PdfPageObject[]> {
    return this.getObjectsByType(pageIndex, [1, 2, 3]);
  }

  /**
   * Replaces text in an existing text object.
   */
  async replaceText(pageIndex: number, objectId: string, newText: string): Promise<void> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const objPtr = this.parseObjectId(objectId);

    const type = this.pdfium.FPDFPageObj_GetType(objPtr);
    if (type !== 1) {
      throw new Error(`Object ${objectId} is not a text object`);
    }

    // Allocate UTF-16LE string
    const bytesNeeded = newText.length * 2 + 2;
    const strPtr = this.wasm._malloc(bytesNeeded);
    
    try {
      this.wasm.stringToUTF16(newText, strPtr, bytesNeeded);
      const success = this.pdfium.FPDFText_SetText(objPtr, strPtr);
      if (!success) {
        throw new Error("Failed to set text on PDFium object");
      }
      this.pdfium.FPDFPage_GenerateContent(page);
    } finally {
      this.wasm._free(strPtr);
    }
  }

  /**
   * Moves an object relative to its current position.
   */
  async moveObject(pageIndex: number, objectId: string, deltaX: number, deltaY: number): Promise<void> {
    await this.transformObject(pageIndex, objectId, {
      a: 1, b: 0, c: 0, d: 1, e: deltaX, f: deltaY
    });
  }

  /**
   * Applies a transformation matrix to an object.
   */
  async transformObject(pageIndex: number, objectId: string, transform: PdfTransform): Promise<void> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const objPtr = this.parseObjectId(objectId);

    this.pdfium.FPDFPageObj_Transform(
      objPtr,
      transform.a, transform.b, transform.c,
      transform.d, transform.e, transform.f
    );
    this.syncShapeMark(objPtr, transform);
    this.pdfium.FPDFPage_GenerateContent(page);
  }

  /**
   * Removes an object from the page.
   */
  async deleteObject(pageIndex: number, objectId: string): Promise<void> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const objPtr = this.parseObjectId(objectId);

    const success = this.pdfium.FPDFPage_RemoveObject(page, objPtr);
    if (!success) {
      throw new Error(`Failed to remove object ${objectId} from page ${pageIndex}`);
    }
    
    this.pdfium.FPDFPageObj_Destroy(objPtr);
    this.pdfium.FPDFPage_GenerateContent(page);
  }

  /**
   * Adds a new text object using a standard font.
   */
  async addText(pageIndex: number, options: PdfTextOptions): Promise<string> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    
    const fontName = options.fontFamily || "Helvetica";
    const fontSize = options.fontSize || 12;
    
    const newTextObj = this.pdfium.FPDFPageObj_NewTextObj(this.docPtr, fontName, fontSize);
    if (!newTextObj) {
      throw new Error(`Failed to create new text object. Font '${fontName}' may be unsupported.`);
    }

    const bytesNeeded = options.text.length * 2 + 2;
    const strPtr = this.wasm._malloc(bytesNeeded);
    
    try {
      this.wasm.stringToUTF16(options.text, strPtr, bytesNeeded);
      const setSuccess = this.pdfium.FPDFText_SetText(newTextObj, strPtr);
      if (!setSuccess) {
        this.pdfium.FPDFPageObj_Destroy(newTextObj);
        throw new Error("Failed to set text content on new object");
      }
      
      const [r, g, b] = options.color ?? [0, 0, 0];
      this.pdfium.FPDFPageObj_SetFillColor(newTextObj, r, g, b, 255);
      this.pdfium.FPDFPageObj_Transform(newTextObj, 1, 0, 0, 1, options.x, options.y);
      this.pdfium.FPDFPage_InsertObject(page, newTextObj);
      this.pdfium.FPDFPage_GenerateContent(page);
      
      return `ptr_${newTextObj}`;
    } finally {
      this.wasm._free(strPtr);
    }
  }

  /**
   * Embeds a raster image into the page content stream. `rgba` is straight
   * (non-premultiplied) RGBA, pixelWidth*pixelHeight*4 bytes, as produced by canvas getImageData.
   * The image occupies the rectangle (x, y, width, height) in PDF points.
   */
  async addImage(pageIndex: number, o: PdfImageOptions): Promise<string> {
    this.ensureDocument();
    if (o.rgba.length !== o.pixelWidth * o.pixelHeight * 4) {
      throw new Error("Image pixel buffer does not match its dimensions");
    }
    const page = this.getPage(pageIndex);
    const bitmap = this.pdfium.FPDFBitmap_Create(o.pixelWidth, o.pixelHeight, 1);
    if (!bitmap) throw new Error("Failed to allocate image bitmap");
    const imgObj = this.pdfium.FPDFPageObj_NewImageObj(this.docPtr);
    try {
      const buf = this.pdfium.FPDFBitmap_GetBuffer(bitmap);
      const stride = this.pdfium.FPDFBitmap_GetStride(bitmap);
      const heap: Uint8Array = this.wasm.HEAPU8;
      for (let y = 0; y < o.pixelHeight; y++) {
        let src = y * o.pixelWidth * 4;
        let dst = buf + y * stride;
        for (let x = 0; x < o.pixelWidth; x++, src += 4, dst += 4) {
          heap[dst] = o.rgba[src + 2];     // B
          heap[dst + 1] = o.rgba[src + 1]; // G
          heap[dst + 2] = o.rgba[src];     // R
          heap[dst + 3] = o.rgba[src + 3]; // A
        }
      }
      if (!this.pdfium.FPDFImageObj_SetBitmap(0, 0, imgObj, bitmap)) {
        throw new Error("PDFium rejected the image bitmap");
      }
      this.pdfium.FPDFImageObj_SetMatrix(imgObj, o.width, 0, 0, o.height, o.x, o.y);
      this.pdfium.FPDFPage_InsertObject(page, imgObj);
      this.pdfium.FPDFPage_GenerateContent(page);
      return `ptr_${imgObj}`;
    } catch (e) {
      this.pdfium.FPDFPageObj_Destroy(imgObj);
      throw e;
    } finally {
      this.pdfium.FPDFBitmap_Destroy(bitmap);
    }
  }

  /** Adds a filled and/or stroked rectangle. Colours are [r,g,b] 0-255. */
  async addRect(pageIndex: number, o: PdfRectOptions): Promise<string> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const rect = this.pdfium.FPDFPageObj_CreateNewRect(o.x, o.y, o.width, o.height);
    if (!rect) throw new Error("Failed to create rectangle");
    if (o.fill) this.pdfium.FPDFPageObj_SetFillColor(rect, o.fill[0], o.fill[1], o.fill[2], 255);
    if (o.stroke) {
      this.pdfium.FPDFPageObj_SetStrokeColor(rect, o.stroke[0], o.stroke[1], o.stroke[2], 255);
      this.pdfium.FPDFPageObj_SetStrokeWidth(rect, o.strokeWidth ?? 1);
    }
    this.pdfium.FPDFPath_SetDrawMode(rect, o.fill ? 1 : 0, !!o.stroke);
    this.pdfium.FPDFPage_InsertObject(page, rect);
    this.pdfium.FPDFPage_GenerateContent(page);
    return `ptr_${rect}`;
  }

  /**
   * Adds a rectangle, ellipse, line or arrow as a native PDF path and marks it "LayahShape" with its parameters, so it
   * can be found, restyled, moved and resized later (marks survive save and reload; other PDF software ignores them).
   * Lines/arrows are stroke-only.
   */
  async addShape(pageIndex: number, o: PdfShapeOptions): Promise<string> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const { x1, y1, x2, y2 } = o;
    const left = Math.min(x1, x2), right = Math.max(x1, x2), bottom = Math.min(y1, y2), top = Math.max(y1, y2);
    const p = this.pdfium;
    let path: number;
    let closed = true;
    if (o.kind === "rect") {
      path = p.FPDFPageObj_CreateNewRect(left, bottom, right - left, top - bottom);
    } else if (o.kind === "ellipse") {
      // Four cubic Béziers approximate an ellipse (k = 4/3 * (sqrt(2) - 1)).
      const cx = (left + right) / 2, cy = (bottom + top) / 2, rx = (right - left) / 2, ry = (top - bottom) / 2, k = 0.5522847498;
      path = p.FPDFPageObj_CreateNewPath(cx + rx, cy);
      p.FPDFPath_BezierTo(path, cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry);
      p.FPDFPath_BezierTo(path, cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy);
      p.FPDFPath_BezierTo(path, cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry);
      p.FPDFPath_BezierTo(path, cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy);
      p.FPDFPath_Close(path);
    } else {
      closed = false;
      path = p.FPDFPageObj_CreateNewPath(x1, y1);
      p.FPDFPath_LineTo(path, x2, y2);
      if (o.kind === "arrow") {
        const len = Math.hypot(x2 - x1, y2 - y1);
        const head = Math.min(len * 0.45, Math.max(10, (o.strokeWidth ?? 2) * 5));
        const ang = Math.atan2(y2 - y1, x2 - x1);
        p.FPDFPath_MoveTo(path, x2 + head * Math.cos(ang + Math.PI - 0.5), y2 + head * Math.sin(ang + Math.PI - 0.5));
        p.FPDFPath_LineTo(path, x2, y2);
        p.FPDFPath_LineTo(path, x2 + head * Math.cos(ang + Math.PI + 0.5), y2 + head * Math.sin(ang + Math.PI + 0.5));
      }
    }
    if (!path) throw new Error("Failed to create shape");
    const stroke = o.stroke ?? [0, 0, 0];
    const width = o.strokeWidth ?? 2;
    p.FPDFPageObj_SetStrokeColor(path, stroke[0], stroke[1], stroke[2], 255);
    p.FPDFPageObj_SetStrokeWidth(path, width);
    p.FPDFPageObj_SetLineCap(path, 1);
    p.FPDFPageObj_SetLineJoin(path, 1);
    const fill = closed ? o.fill : undefined;
    if (fill) p.FPDFPageObj_SetFillColor(path, fill[0], fill[1], fill[2], 255);
    p.FPDFPath_SetDrawMode(path, fill ? 1 : 0, true);
    this.writeShapeMark(path, { ...o, stroke, strokeWidth: width, fill });
    p.FPDFPage_InsertObject(page, path);
    p.FPDFPage_GenerateContent(page);
    return `ptr_${path}`;
  }

  /** Stores the shape's parameters on the object as marked content so they survive save/reload. */
  private writeShapeMark(obj: number, o: PdfShapeOptions): void {
    const p = this.pdfium;
    const mark = p.FPDFPageObj_AddMark(obj, SHAPE_MARK);
    if (!mark) throw new Error("Failed to mark shape");
    const setI = (k: string, v: number) => p.FPDFPageObjMark_SetIntParam(this.docPtr, obj, mark, k, Math.round(v));
    const setF = (k: string, v: number) => p.FPDFPageObjMark_SetFloatParam(this.docPtr, obj, mark, k, v);
    setI("lk", SHAPE_KINDS.indexOf(o.kind));
    setF("x1", o.x1); setF("y1", o.y1); setF("x2", o.x2); setF("y2", o.y2);
    setF("sw", o.strokeWidth ?? 2);
    const st = o.stroke ?? [0, 0, 0];
    setI("sr", st[0]); setI("sg", st[1]); setI("sb", st[2]);
    setI("hf", o.fill ? 1 : 0);
    const fi = o.fill ?? [0, 0, 0];
    setI("fr", fi[0]); setI("fg", fi[1]); setI("fb", fi[2]);
  }

  /** The mark pointer if `obj` is a shape drawn by this editor, else 0. */
  private findShapeMark(obj: number): number {
    const n = this.pdfium.FPDFPageObj_CountMarks(obj);
    if (!n) return 0;
    const buf = this.wasm._malloc(4);
    try {
      for (let i = 0; i < n; i++) {
        const mark = this.pdfium.FPDFPageObj_GetMark(obj, i);
        if (mark && this.pdfium.FPDFPageObjMark_GetParamIntValue(mark, "lk", buf)) return mark;
      }
      return 0;
    } finally {
      this.wasm._free(buf);
    }
  }

  private readShape(obj: number): PdfShapeOptions | null {
    const mark = this.findShapeMark(obj);
    if (!mark) return null;
    const buf = this.wasm._malloc(4);
    try {
      const getI = (k: string) => (this.pdfium.FPDFPageObjMark_GetParamIntValue(mark, k, buf) ? this.wasm.getValue(buf, "i32") : 0);
      const getF = (k: string) => (this.pdfium.FPDFPageObjMark_GetParamFloatValue(mark, k, buf) ? this.wasm.getValue(buf, "float") : 0);
      const kind = SHAPE_KINDS[getI("lk")];
      if (!kind) return null;
      return {
        kind, x1: getF("x1"), y1: getF("y1"), x2: getF("x2"), y2: getF("y2"), strokeWidth: getF("sw"),
        stroke: [getI("sr"), getI("sg"), getI("sb")],
        fill: getI("hf") ? [getI("fr"), getI("fg"), getI("fb")] : undefined,
      };
    } finally {
      this.wasm._free(buf);
    }
  }

  /** After a move/scale the stored points (and stroke width) must follow the object, or later restyling would snap it back. */
  private syncShapeMark(obj: number, t: PdfTransform): void {
    const mark = this.findShapeMark(obj);
    if (!mark) return;
    const s = this.readShape(obj);
    if (!s) return;
    const set = (k: string, v: number) => this.pdfium.FPDFPageObjMark_SetFloatParam(this.docPtr, obj, mark, k, v);
    set("x1", t.a * s.x1 + t.c * s.y1 + t.e); set("y1", t.b * s.x1 + t.d * s.y1 + t.f);
    set("x2", t.a * s.x2 + t.c * s.y2 + t.e); set("y2", t.b * s.x2 + t.d * s.y2 + t.f);
    set("sw", (s.strokeWidth ?? 2) * Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)));
  }

  /**
   * Exports the mutated document to a new Uint8Array.
   */
  async export(): Promise<Uint8Array> {
    this.ensureDocument();

    const outChunks: Uint8Array[] = [];
    
    const writeBlockFn = this.wasm.addFunction((_pThis: number, pData: number, size: number) => {
      const chunk = new Uint8Array(this.wasm.HEAPU8.subarray(pData, pData + size));
      outChunks.push(chunk);
      return 1; // success
    }, "iiii");
    
    const pFileWrite = this.wasm._malloc(8);
    try {
      this.wasm.setValue(pFileWrite, 1, "i32"); // version = 1
      this.wasm.setValue(pFileWrite + 4, writeBlockFn, "i32"); // WriteBlock func ptr

      const success = this.pdfium.FPDF_SaveAsCopy(this.docPtr, pFileWrite, 0);
      if (!success) {
        throw new Error("Failed to export PDF through PDFium");
      }
      
      const totalSize = outChunks.reduce((acc, c) => acc + c.length, 0);
      const outBytes = new Uint8Array(totalSize);
      let offset = 0;
      for (const c of outChunks) {
        outBytes.set(c, offset);
        offset += c.length;
      }
      return outBytes;
    } finally {
      this.wasm._free(pFileWrite);
      this.wasm.removeFunction(writeBlockFn);
    }
  }

  /**
   * Safely frees all PDFium handles and WASM memory.
   */
  dispose(): void {
    this.cleanupDocument();
  }

  // --- Private Helpers ---

  private ensureInitialized() {
    if (!this.pdfium || !this.wasm) {
      throw new Error("PdfEditorEngine is not initialized. Call initialize() first.");
    }
  }

  private ensureDocument() {
    this.ensureInitialized();
    if (!this.docPtr) {
      throw new Error("No PDF document is currently loaded.");
    }
  }

  private getPage(pageIndex: number): number {
    if (this.pages.has(pageIndex)) {
      return this.pages.get(pageIndex)!;
    }
    const pagePtr = this.pdfium.FPDF_LoadPage(this.docPtr, pageIndex);
    if (!pagePtr) {
      throw new Error(`Failed to load page index ${pageIndex}`);
    }
    this.pages.set(pageIndex, pagePtr);
    return pagePtr;
  }

  private cleanupDocument() {
    // Close all open pages
    for (const pagePtr of this.pages.values()) {
      this.pdfium.FPDF_ClosePage(pagePtr);
    }
    this.pages.clear();

    // Close document
    if (this.docPtr) {
      this.pdfium.FPDF_CloseDocument(this.docPtr);
      this.docPtr = null;
    }

    // Free document buffer
    if (this.docBufferPtr) {
      this.wasm._free(this.docBufferPtr);
      this.docBufferPtr = null;
    }
  }

  private parseObjectId(id: string): number {
    if (!id.startsWith("ptr_")) {
      throw new Error(`Invalid object ID format: ${id}`);
    }
    return parseInt(id.replace("ptr_", ""), 10);
  }

  private async getObjectsByType(pageIndex: number, targetTypes: number[]): Promise<PdfPageObject[]> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const objectCount = this.pdfium.FPDFPage_CountObjects(page);
    const results: PdfPageObject[] = [];
    const textPage = targetTypes.includes(1) ? this.pdfium.FPDFText_LoadPage(page) : 0;
    try {
    for (let i = 0; i < objectCount; i++) {
      const objPtr = this.pdfium.FPDFPage_GetObject(page, i);
      const type = this.pdfium.FPDFPageObj_GetType(objPtr);
      
      // Paths are only editable when this editor drew them (marked); every other vector line stays untouched.
      let shape: PdfShapeOptions | null = null;
      if (type === 2 && targetTypes.includes(2)) {
        shape = this.readShape(objPtr);
        if (!shape) continue;
      }

      if (targetTypes.includes(type)) {
        const bounds = this.getObjectBounds(objPtr);
        const transform = this.getObjectMatrix(objPtr);
        const id = `ptr_${objPtr}`;

        if (type === 1) {
          // TEXT
          const text = this.extractText(textPage, objPtr);
          let fontSize: number | undefined;
          let fontWeight: number | undefined;
          let italicAngle: number | undefined;

          const floatPtr = this.wasm._malloc(4);
          try {
            if (this.pdfium.FPDFTextObj_GetFontSize(objPtr, floatPtr)) {
              fontSize = this.wasm.getValue(floatPtr, "float");
            }
          } finally {
            this.wasm._free(floatPtr);
          }

          let fontName: string | undefined;
          const fontPtr = this.pdfium.FPDFTextObj_GetFont(objPtr);
          if (fontPtr) {
            fontName = this.readFontName(fontPtr);
            fontWeight = this.pdfium.FPDFFont_GetWeight(fontPtr);
            const intPtr = this.wasm._malloc(4);
            try {
              if (this.pdfium.FPDFFont_GetItalicAngle(fontPtr, intPtr)) {
                italicAngle = this.wasm.getValue(intPtr, "i32");
              }
            } finally {
              this.wasm._free(intPtr);
            }
          }

          results.push({ id, type: "text", pageIndex, bounds, transform, text, fontSize, fontWeight, italicAngle, fontName } as PdfTextObject);
        } else if (type === 3) {
          // IMAGE
          results.push({ id, type: "image", pageIndex, bounds, transform } as PdfImageObject);
        } else if (type === 2 && shape) {
          results.push({ id, type: "shape", pageIndex, bounds, transform, shape } as PdfShapeObject);
        }
      }
    }
    } finally {
      if (textPage) this.pdfium.FPDFText_ClosePage(textPage);
    }
    return results;
  }

  private readFontName(fontPtr: number): string | undefined {
    const len = this.pdfium.FPDFFont_GetBaseFontName(fontPtr, 0, 0);
    if (!len) return undefined;
    const ptr = this.wasm._malloc(len);
    try {
      this.pdfium.FPDFFont_GetBaseFontName(fontPtr, ptr, len);
      return this.wasm.UTF8ToString(ptr);
    } finally {
      this.wasm._free(ptr);
    }
  }

  private getObjectBounds(objPtr: number) {
    const leftPtr = this.wasm._malloc(4);
    const bottomPtr = this.wasm._malloc(4);
    const rightPtr = this.wasm._malloc(4);
    const topPtr = this.wasm._malloc(4);

    try {
      this.pdfium.FPDFPageObj_GetBounds(objPtr, leftPtr, bottomPtr, rightPtr, topPtr);
      return {
        left: this.wasm.getValue(leftPtr, "float"),
        bottom: this.wasm.getValue(bottomPtr, "float"),
        right: this.wasm.getValue(rightPtr, "float"),
        top: this.wasm.getValue(topPtr, "float"),
      };
    } finally {
      this.wasm._free(leftPtr);
      this.wasm._free(bottomPtr);
      this.wasm._free(rightPtr);
      this.wasm._free(topPtr);
    }
  }

  private getObjectMatrix(objPtr: number): PdfTransform | null {
    const matrixPtr = this.wasm._malloc(24);
    try {
      const hasMatrix = this.pdfium.FPDFPageObj_GetMatrix(objPtr, matrixPtr);
      if (hasMatrix) {
        return {
          a: this.wasm.getValue(matrixPtr, "float"),
          b: this.wasm.getValue(matrixPtr + 4, "float"),
          c: this.wasm.getValue(matrixPtr + 8, "float"),
          d: this.wasm.getValue(matrixPtr + 12, "float"),
          e: this.wasm.getValue(matrixPtr + 16, "float"),
          f: this.wasm.getValue(matrixPtr + 20, "float"),
        };
      }
      return null;
    } finally {
      this.wasm._free(matrixPtr);
    }
  }

  private extractText(textPage: number, objPtr: number): string {
    const needed = this.pdfium.FPDFTextObj_GetText(objPtr, textPage, 0, 0);
    const capacity = Math.max(needed, 2);
    const bufferPtr = this.wasm._malloc(capacity);
    
    try {
      const reqSize = this.pdfium.FPDFTextObj_GetText(objPtr, textPage, bufferPtr, capacity);
      if (reqSize > 0) {
        const textBytes = this.wasm.HEAPU8.slice(bufferPtr, bufferPtr + reqSize);
        let text = "";
        for (let j = 0; j < textBytes.length - 2; j += 2) {
          const code = textBytes[j] | (textBytes[j+1] << 8);
          if (code === 0) break;
          text += String.fromCharCode(code);
        }
        return text;
      }
      return "";
    } finally {
      this.wasm._free(bufferPtr);
    }
  }
}
