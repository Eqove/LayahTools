import { init } from "@embedpdf/pdfium";
import type { 
  PdfPageInfo, 
  PdfTextObject, 
  PdfImageObject, 
  PdfPageObject, 
  PdfTransform, 
  PdfTextOptions 
} from "./types";

/**
 * A high-level abstraction over the PDFium WASM engine for deep visual PDF edits.
 * Designed to cleanly encapsulate all raw pointer, malloc/free, and C-struct logic.
 */
export class PdfEditorEngine {
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
        // Fallback to CDN for browser lazy-loading
        const cdnUrl = "https://cdn.jsdelivr.net/npm/@embedpdf/pdfium/dist/pdfium.wasm";
        const response = await fetch(cdnUrl);
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
      this.cleanupDocument();
      throw new Error("Failed to load PDF document in PDFium");
    }
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

    return {
      pageIndex,
      width,
      height,
      objectCount
    };
  }

  /**
   * Retrieves all text objects on a specific page.
   */
  async getTextObjects(pageIndex: number): Promise<PdfTextObject[]> {
    return this.getObjectsByType(pageIndex, 1) as Promise<PdfTextObject[]>;
  }

  /**
   * Retrieves all image objects on a specific page.
   */
  async getImageObjects(pageIndex: number): Promise<PdfImageObject[]> {
    return this.getObjectsByType(pageIndex, 3) as Promise<PdfImageObject[]>;
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
      
      this.pdfium.FPDFPageObj_Transform(newTextObj, 1, 0, 0, 1, options.x, options.y);
      this.pdfium.FPDFPage_InsertObject(page, newTextObj);
      this.pdfium.FPDFPage_GenerateContent(page);
      
      return `ptr_${newTextObj}`;
    } finally {
      this.wasm._free(strPtr);
    }
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

  private async getObjectsByType(pageIndex: number, targetType: number): Promise<PdfPageObject[]> {
    this.ensureDocument();
    const page = this.getPage(pageIndex);
    const objectCount = this.pdfium.FPDFPage_CountObjects(page);
    const results: PdfPageObject[] = [];

    for (let i = 0; i < objectCount; i++) {
      const objPtr = this.pdfium.FPDFPage_GetObject(page, i);
      const type = this.pdfium.FPDFPageObj_GetType(objPtr);
      
      if (type === targetType) {
        const bounds = this.getObjectBounds(objPtr);
        const transform = this.getObjectMatrix(objPtr);
        const id = `ptr_${objPtr}`;

        if (type === 1) {
          // TEXT
          const text = this.extractText(page, objPtr);
          results.push({ id, type: "text", pageIndex, bounds, transform, text } as PdfTextObject);
        } else if (type === 3) {
          // IMAGE
          results.push({ id, type: "image", pageIndex, bounds, transform } as PdfImageObject);
        }
      }
    }
    
    return results;
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

  private extractText(pagePtr: number, objPtr: number): string {
    const textPage = this.pdfium.FPDFText_LoadPage(pagePtr);
    const bufferPtr = this.wasm._malloc(2048);
    
    try {
      const reqSize = this.pdfium.FPDFTextObj_GetText(objPtr, textPage, bufferPtr, 2048);
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
      this.pdfium.FPDFText_ClosePage(textPage);
    }
  }
}
