export interface PdfPoint {
  x: number;
  y: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface PdfBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PageCoordinateContext {
  /** Unrotated PDF width in points */
  width: number;
  /** Unrotated PDF height in points */
  height: number;
  /** Scale factor (e.g. 1.0 = 100%) */
  zoom: number;
  /** Clockwise rotation in degrees (0, 90, 180, 270) */
  rotation?: number;
}

/**
 * Converts a PDF point (bottom-left origin, Y goes up) 
 * to a Viewport point (top-left origin, CSS pixels, Y goes down).
 */
export function pdfToViewportPoint(pdf: PdfPoint, ctx: PageCoordinateContext): ViewportPoint {
  const z = ctx.zoom;
  const rot = (ctx.rotation || 0) % 360;

  let vpX = 0;
  let vpY = 0;

  if (rot === 0) {
    vpX = pdf.x * z;
    vpY = (ctx.height - pdf.y) * z;
  } else if (rot === 90) {
    vpX = (ctx.height - pdf.y) * z;
    vpY = pdf.x * z;
  } else if (rot === 180) {
    vpX = (ctx.width - pdf.x) * z;
    vpY = pdf.y * z;
  } else if (rot === 270 || rot === -90) {
    vpX = pdf.y * z;
    vpY = (ctx.width - pdf.x) * z;
  }

  return { x: vpX, y: vpY };
}

/**
 * Converts a Viewport point (top-left origin, CSS pixels, Y goes down)
 * back to a PDF point (bottom-left origin, Y goes up).
 */
export function viewportToPdfPoint(vp: ViewportPoint, ctx: PageCoordinateContext): PdfPoint {
  const z = ctx.zoom;
  const rot = (ctx.rotation || 0) % 360;

  let pdfX = 0;
  let pdfY = 0;

  if (rot === 0) {
    pdfX = vp.x / z;
    pdfY = ctx.height - (vp.y / z);
  } else if (rot === 90) {
    pdfX = vp.y / z;
    pdfY = ctx.height - (vp.x / z);
  } else if (rot === 180) {
    pdfX = ctx.width - (vp.x / z);
    pdfY = vp.y / z;
  } else if (rot === 270 || rot === -90) {
    pdfX = ctx.width - (vp.y / z);
    pdfY = vp.x / z;
  }

  return { x: pdfX, y: pdfY };
}

/**
 * Converts PDF bounds to Viewport bounds.
 * Note: PDF bounds use {left, bottom, right, top}.
 * Viewport bounds use {left, top, right, bottom} matching CSS coordinates.
 */
export function pdfToViewportBounds(pdf: PdfBounds, ctx: PageCoordinateContext): ViewportBounds {
  // Convert all 4 corners to account for rotation cleanly
  const corners = [
    pdfToViewportPoint({ x: pdf.left, y: pdf.bottom }, ctx),
    pdfToViewportPoint({ x: pdf.right, y: pdf.bottom }, ctx),
    pdfToViewportPoint({ x: pdf.left, y: pdf.top }, ctx),
    pdfToViewportPoint({ x: pdf.right, y: pdf.top }, ctx),
  ];

  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/**
 * Converts Viewport bounds back to PDF bounds.
 */
export function viewportToPdfBounds(vp: ViewportBounds, ctx: PageCoordinateContext): PdfBounds {
  const corners = [
    viewportToPdfPoint({ x: vp.left, y: vp.top }, ctx),
    viewportToPdfPoint({ x: vp.right, y: vp.top }, ctx),
    viewportToPdfPoint({ x: vp.left, y: vp.bottom }, ctx),
    viewportToPdfPoint({ x: vp.right, y: vp.bottom }, ctx),
  ];

  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

/**
 * Converts a pure Viewport delta (movement distance) into a PDF delta.
 * Useful for dragging interactions.
 */
export function viewportDeltaToPdfDelta(dx: number, dy: number, ctx: PageCoordinateContext): PdfPoint {
  const z = ctx.zoom;
  const rot = (ctx.rotation || 0) % 360;

  if (rot === 0) {
    return { x: dx / z, y: -dy / z }; // Moving mouse down (+dy) means PDF point moves down (-y)
  } else if (rot === 90) {
    return { x: dy / z, y: -dx / z };
  } else if (rot === 180) {
    return { x: -dx / z, y: dy / z };
  } else if (rot === 270 || rot === -90) {
    return { x: -dy / z, y: dx / z };
  }
  
  return { x: dx / z, y: -dy / z }; // Fallback
}
