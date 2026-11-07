import type { PdfImageOptions, PdfPageInfo, PdfPageObject, PdfRectOptions, PdfTextOptions, PdfTransform } from "./types";

/**
 * The narrow engine surface `EditorSession` depends on (types only). `PdfEditorEngine` implements it; tests inject
 * counting / fault-injecting doubles through `new EditorSession({ engineFactory })`. Object handles are opaque strings
 * valid only until the next `load()`. Implementations must not call back into the session.
 */
export interface EditorEngine {
  initialize(wasmBinary?: ArrayBuffer): Promise<void>;
  /** Throws `EngineError` (kind "password" | "format") when the bytes cannot be opened. */
  load(bytes: Uint8Array): Promise<void>;
  getPageCount(): Promise<number>;
  inspectPage(pageIndex: number): Promise<PdfPageInfo>;
  getEditableObjects(pageIndex: number): Promise<PdfPageObject[]>;
  getFillColor(objectId: string): [number, number, number] | null;
  replaceText(pageIndex: number, objectId: string, newText: string): Promise<void>;
  moveObject(pageIndex: number, objectId: string, deltaX: number, deltaY: number): Promise<void>;
  transformObject(pageIndex: number, objectId: string, transform: PdfTransform): Promise<void>;
  deleteObject(pageIndex: number, objectId: string): Promise<void>;
  addText(pageIndex: number, options: PdfTextOptions): Promise<string>;
  addImage(pageIndex: number, options: PdfImageOptions): Promise<string>;
  addRect(pageIndex: number, options: PdfRectOptions): Promise<string>;
  /** Must return a freshly allocated array every call. */
  export(): Promise<Uint8Array>;
  dispose(): void;
}
