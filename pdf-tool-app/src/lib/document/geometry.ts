import { LayahTextObject, LayahObjectBounds } from "./types";

export interface NormalizedTextGeometry {
  id: string;
  pageIndex: number;
  text: string;
  bounds: LayahObjectBounds;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  rotationAngle: number; // in degrees
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  isItalic?: boolean;
}

export interface TextGeometryOptions {
  /** Maximum horizontal gap to consider objects part of the same reading region/column (PDF points) */
  maxRegionHorizontalGap: number;
  /** Maximum vertical gap to consider objects part of the same reading region/column (PDF points) */
  maxRegionVerticalGap: number;
  /** Maximum vertical center difference to consider objects on the same visual line (PDF points) */
  sameLineVerticalTolerance: number;
}

export const DEFAULT_GEOMETRY_OPTIONS: TextGeometryOptions = {
  maxRegionHorizontalGap: 40,
  maxRegionVerticalGap: 30,
  sameLineVerticalTolerance: 8,
};

export interface ReadingOrderResult {
  orderedObjectIds: string[];
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

/**
 * Derives normalized geometric facts from a raw LayahTextObject.
 * Calculates width, height, centers, and explicit rotation.
 */
export function deriveTextGeometry(obj: LayahTextObject): NormalizedTextGeometry {
  const width = Math.max(0, obj.bounds.right - obj.bounds.left);
  const height = Math.max(0, obj.bounds.top - obj.bounds.bottom);
  const centerX = obj.bounds.left + width / 2;
  const centerY = obj.bounds.bottom + height / 2;

  let rotationAngle = 0;
  if (obj.transform) {
    // A standard 2D affine transform matrix [a, b, c, d, e, f]
    // Rotation can be extracted via atan2(b, a)
    rotationAngle = Math.atan2(obj.transform.b, obj.transform.a) * (180 / Math.PI);
    // Normalize to 0-360 if desired, but -180 to 180 is fine
  }

  return {
    id: obj.id,
    pageIndex: obj.pageIndex,
    text: obj.text,
    bounds: { ...obj.bounds },
    width,
    height,
    centerX,
    centerY,
    rotationAngle,
    fontFamily: obj.fontFamily,
    fontSize: obj.fontSize,
    fontWeight: obj.fontWeight,
    isItalic: obj.isItalic,
  };
}

/**
 * Determines if two normalized text objects share a horizontal or vertical region cluster.
 */
function areInSameRegion(a: NormalizedTextGeometry, b: NormalizedTextGeometry, options: TextGeometryOptions): boolean {
  const hGap = Math.max(0, Math.max(a.bounds.left, b.bounds.left) - Math.min(a.bounds.right, b.bounds.right));
  const vGap = Math.max(0, Math.max(a.bounds.bottom, b.bounds.bottom) - Math.min(a.bounds.top, b.bounds.top));

  return hGap <= options.maxRegionHorizontalGap && vGap <= options.maxRegionVerticalGap;
}

interface GeometricRegion {
  id: string;
  bounds: LayahObjectBounds;
  objects: NormalizedTextGeometry[];
}

/**
 * Resolves deterministic reading order from an unstructured list of text objects.
 * Implements basic column awareness by grouping into Regions, then sorting Regions top-down/left-right.
 * Returns an ordered array of source object IDs.
 */
export function getReadingOrder(
  sourceObjects: LayahTextObject[],
  options: Partial<TextGeometryOptions> = {}
): ReadingOrderResult {
  const opts = { ...DEFAULT_GEOMETRY_OPTIONS, ...options };
  const reasons: string[] = [];
  let confidence: "high" | "medium" | "low" = "high";

  if (sourceObjects.length === 0) {
    return { orderedObjectIds: [], confidence: "high", reasons: ["No objects"] };
  }

  const geometries = sourceObjects.map(deriveTextGeometry);

  // Check for severe rotations which degrade our axis-aligned bounding box heuristic
  const hasRotatedText = geometries.some((g) => Math.abs(g.rotationAngle) > 5);
  if (hasRotatedText) {
    confidence = "medium";
    reasons.push("Presence of rotated text reduces reading-order confidence.");
  }

  // 1. Graph Connected Components (Region Clustering)
  // Connect objects that are geometrically close enough to be in the same block/column
  const parent = new Map<string, string>();
  const find = (i: string): string => {
    if (parent.get(i) === i) return i;
    const p = find(parent.get(i)!);
    parent.set(i, p);
    return p;
  };
  const union = (i: string, j: string) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent.set(rootI, rootJ);
  };

  for (const g of geometries) parent.set(g.id, g.id);

  for (let i = 0; i < geometries.length; i++) {
    for (let j = i + 1; j < geometries.length; j++) {
      if (areInSameRegion(geometries[i], geometries[j], opts)) {
        union(geometries[i].id, geometries[j].id);
      }
    }
  }

  // 2. Build Regions
  const groups = new Map<string, NormalizedTextGeometry[]>();
  for (const g of geometries) {
    const root = find(g.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(g);
  }

  const regions: GeometricRegion[] = Array.from(groups.entries()).map(([rootId, objects]) => {
    const minLeft = Math.min(...objects.map((o) => o.bounds.left));
    const minBottom = Math.min(...objects.map((o) => o.bounds.bottom));
    const maxRight = Math.max(...objects.map((o) => o.bounds.right));
    const maxTop = Math.max(...objects.map((o) => o.bounds.top));

    return {
      id: rootId,
      bounds: { left: minLeft, bottom: minBottom, right: maxRight, top: maxTop },
      objects,
    };
  });

  if (regions.length > 1) {
    reasons.push(`Detected ${regions.length} distinct geometric regions (column awareness active).`);
  }

  // 3. Sort Regions (Top-to-Bottom, Left-to-Right fallback)
  // Because PDF origin is bottom-left, Top is higher Y.
  regions.sort((r1, r2) => {
    const topDiff = r2.bounds.top - r1.bounds.top; // Descending Y
    // If tops are within vertical tolerance, they are parallel (e.g. columns) -> sort Left-to-Right
    if (Math.abs(topDiff) > opts.sameLineVerticalTolerance * 2) {
      return topDiff;
    }
    return r1.bounds.left - r2.bounds.left; // Ascending X
  });

  // 4. Sort within Regions (Lines Top-to-Bottom, Objects Left-to-Right)
  const orderedObjectIds: string[] = [];

  for (const region of regions) {
    // Sort all objects in region strictly top-to-bottom
    const sortedRegionObjs = region.objects.sort((a, b) => {
      // Use centerY for a more stable line baseline heuristic if bounds slightly fluctuate
      const yDiff = b.centerY - a.centerY;
      if (Math.abs(yDiff) > opts.sameLineVerticalTolerance) {
        return yDiff; // Descending Y
      }
      return a.bounds.left - b.bounds.left; // Ascending X
    });

    const lines: NormalizedTextGeometry[][] = [];
    let currentLine: NormalizedTextGeometry[] = [];
    let currentLineCenterY = -1;

    for (const obj of sortedRegionObjs) {
      if (currentLine.length === 0) {
        currentLine.push(obj);
        currentLineCenterY = obj.centerY;
      } else {
        if (Math.abs(currentLineCenterY - obj.centerY) <= opts.sameLineVerticalTolerance) {
          currentLine.push(obj);
          // Gently shift the line center moving average if fonts vary wildly
          currentLineCenterY = (currentLineCenterY + obj.centerY) / 2;
        } else {
          lines.push(currentLine);
          currentLine = [obj];
          currentLineCenterY = obj.centerY;
        }
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);

    for (const line of lines) {
      // Guarantee left-to-right within the strictly grouped line
      line.sort((a, b) => a.bounds.left - b.bounds.left);
      for (const obj of line) {
        orderedObjectIds.push(obj.id);
      }
    }
  }

  return {
    orderedObjectIds,
    confidence,
    reasons,
  };
}
