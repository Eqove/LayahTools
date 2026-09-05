export interface PdfObjectBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface PdfTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface PdfTextObject {
  id: string;
  type: "text";
  pageIndex: number;
  text: string;
  bounds: PdfObjectBounds;
  transform: PdfTransform | null;
}

export interface PdfImageObject {
  id: string;
  type: "image";
  pageIndex: number;
  bounds: PdfObjectBounds;
  transform: PdfTransform | null;
}

export type PdfPageObject = PdfTextObject | PdfImageObject;

export interface PdfPageInfo {
  pageIndex: number;
  width: number;
  height: number;
  objectCount: number;
}

export interface PdfTextOptions {
  text: string;
  x: number;
  y: number;
  fontFamily?: string;
  fontSize?: number;
}
