import { LayahObjectBounds } from "./types";
import { PdfPoint } from "./coordinates";

export interface HitTestableObject {
  id: string;
  bounds: LayahObjectBounds;
  // Allows hit testing to prioritize smaller objects (e.g. text run over text block) if they both overlap
  area?: number; 
}

/**
 * Given a PDF point, returns the ID of the top-most/most specific object under that point.
 * Prioritizes:
 * 1. Contains the point
 * 2. Smallest area (most specific)
 * 3. Stable deterministic ID sort fallback
 */
export function hitTestPoint(pdfPt: PdfPoint, objects: HitTestableObject[]): string | null {
  const matches = objects.filter(obj => 
    pdfPt.x >= obj.bounds.left &&
    pdfPt.x <= obj.bounds.right &&
    pdfPt.y >= obj.bounds.bottom &&
    pdfPt.y <= obj.bounds.top
  );

  if (matches.length === 0) return null;

  // Enhance with area if missing to allow sorting
  const matchesWithArea = matches.map(m => {
    const area = m.area ?? ((m.bounds.right - m.bounds.left) * (m.bounds.top - m.bounds.bottom));
    return { ...m, computedArea: area };
  });

  matchesWithArea.sort((a, b) => {
    // 1. Sort by area ascending (smallest is most specific, e.g. a Line inside a Block)
    if (a.computedArea !== b.computedArea) {
      return a.computedArea - b.computedArea;
    }
    // 2. Deterministic fallback
    return a.id.localeCompare(b.id);
  });

  return matchesWithArea[0].id;
}
