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
  fontSize?: number;
  fontWeight?: number;
  italicAngle?: number;
  fontName?: string;
}

export interface PdfImageObject {
  id: string;
  type: "image";
  pageIndex: number;
  bounds: PdfObjectBounds;
  transform: PdfTransform | null;
}

/** A shape drawn by this editor (path marked "LayahShape"); its parameters travel with the object in the PDF. */
export interface PdfShapeObject {
  id: string;
  type: "shape";
  pageIndex: number;
  bounds: PdfObjectBounds;
  transform: PdfTransform | null;
  shape: PdfShapeOptions;
}

export type PdfPageObject = PdfTextObject | PdfImageObject | PdfShapeObject;

export interface PdfPageInfo {
  pageIndex: number;
  width: number;
  height: number;
  objectCount: number;
  /** Page /Rotate in degrees (0/90/180/270). */
  rotation: number;
}

export interface PdfTextOptions {
  text: string;
  x: number;
  y: number;
  fontFamily?: string;
  fontSize?: number;
  /** [r,g,b] 0-255 */
  color?: [number, number, number];
}

export interface PdfImageOptions {
  rgba: Uint8Array | Uint8ClampedArray;
  pixelWidth: number;
  pixelHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A shape drawn from (x1,y1) to (x2,y2) in PDF points. For a rectangle/ellipse the two points are opposite corners. */
export interface PdfShapeOptions {
  kind: "rect" | "ellipse" | "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Closed shapes only (rect, ellipse). */
  fill?: [number, number, number];
  stroke?: [number, number, number];
  strokeWidth?: number;
}

export interface PdfRectOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: [number, number, number];
  stroke?: [number, number, number];
  strokeWidth?: number;
}
