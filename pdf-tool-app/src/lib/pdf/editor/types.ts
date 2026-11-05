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

export type PdfPageObject = PdfTextObject | PdfImageObject;

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

export interface PdfRectOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: [number, number, number];
  stroke?: [number, number, number];
  strokeWidth?: number;
}
