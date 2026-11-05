import { LayahObjectBounds } from "./types";
import { NormalizedTextGeometry, ReadingOrderResult } from "./geometry";

export interface LayahTextLine {
  id: string;
  pageIndex: number;
  sourceObjectIds: string[];
  bounds: LayahObjectBounds;
  confidence: "high" | "medium" | "low";
}

export interface TextLineInferenceOptions {
  /** Maximum Y-center difference to be considered the same visual line */
  sameLineVerticalTolerance: number;
  /** Minimum vertical overlap ratio (relative to smaller object height) to be considered the same line */
  minimumVerticalOverlapRatio: number;
  /** Maximum allowable horizontal gap multiplier (relative to line's max object height) */
  maximumHorizontalGapMultiplier: number;
  /** Maximum absolute horizontal gap fallback (for very small text) */
  absoluteMaximumHorizontalGap: number;
  /** Maximum difference in rotation angle (degrees) */
  rotationTolerance: number;
}

export const DEFAULT_LINE_OPTIONS: TextLineInferenceOptions = {
  sameLineVerticalTolerance: 5,
  minimumVerticalOverlapRatio: 0.5,
  maximumHorizontalGapMultiplier: 5.0, // 5x the font height represents a huge tab/gap
  absoluteMaximumHorizontalGap: 100,
  rotationTolerance: 3.0,
};

/**
 * Infers explicit TextLines from an ordered sequence of geometry facts.
 * Groups contiguous objects from the reading order into derived line containers.
 */
export function inferTextLines(
  geometries: NormalizedTextGeometry[],
  readingOrder: ReadingOrderResult,
  options: Partial<TextLineInferenceOptions> = {}
): LayahTextLine[] {
  const opts = { ...DEFAULT_LINE_OPTIONS, ...options };
  const lines: LayahTextLine[] = [];
  
  if (!readingOrder.orderedObjectIds.length || !geometries.length) {
    return lines;
  }

  // Quick lookup map
  const geomMap = new Map<string, NormalizedTextGeometry>();
  for (const g of geometries) {
    geomMap.set(g.id, g);
  }

  let currentLineIds: string[] = [];
  let currentBounds: LayahObjectBounds | null = null;
  let currentCenterY = 0;
  let currentMaxHeight = 0;
  let currentRotation = 0;
  let lineConfidence: "high" | "medium" | "low" = "high";
  let pageIndex = -1;

  const pushLine = () => {
    if (currentLineIds.length > 0 && currentBounds) {
      lines.push({
        id: `line-${lines.length + 1}-${currentLineIds[0]}`,
        pageIndex,
        sourceObjectIds: [...currentLineIds],
        bounds: { ...currentBounds },
        confidence: lineConfidence,
      });
    }
  };

  const startNewLine = (geom: NormalizedTextGeometry) => {
    currentLineIds = [geom.id];
    currentBounds = { ...geom.bounds };
    currentCenterY = geom.centerY;
    currentMaxHeight = geom.height;
    currentRotation = geom.rotationAngle;
    pageIndex = geom.pageIndex;
    
    lineConfidence = "high";
    if (Math.abs(geom.rotationAngle) > opts.rotationTolerance) {
      lineConfidence = "medium";
    }
  };

  for (const id of readingOrder.orderedObjectIds) {
    const geom = geomMap.get(id);
    if (!geom) continue;

    if (currentLineIds.length === 0) {
      startNewLine(geom);
      continue;
    }

    // Check compatibility with the current line
    let isCompatible = true;
    let confidenceDrop: "medium" | "low" | null = null;

    // 1. Page match
    if (geom.pageIndex !== pageIndex) {
      isCompatible = false;
    }

    // 2. Rotation match
    if (isCompatible && Math.abs(geom.rotationAngle - currentRotation) > opts.rotationTolerance) {
      isCompatible = false;
    }

    // 3. Vertical alignment (either close centers OR significant bounding box overlap)
    if (isCompatible) {
      const yDiff = Math.abs(geom.centerY - currentCenterY);
      const verticalOverlap = Math.max(0, Math.min(geom.bounds.top, currentBounds!.top) - Math.max(geom.bounds.bottom, currentBounds!.bottom));
      const minHeight = Math.min(geom.height, currentMaxHeight);
      const overlapRatio = minHeight > 0 ? verticalOverlap / minHeight : 0;

      if (yDiff > opts.sameLineVerticalTolerance && overlapRatio < opts.minimumVerticalOverlapRatio) {
        isCompatible = false;
      }
    }

    // 4. Horizontal proximity
    if (isCompatible) {
      // Gap between right edge of current line and left edge of new object
      const gapX = geom.bounds.left - currentBounds!.right;
      const maxAllowedGap = Math.max(
        opts.absoluteMaximumHorizontalGap,
        currentMaxHeight * opts.maximumHorizontalGapMultiplier
      );
      
      if (gapX > maxAllowedGap) {
        // Enormous horizontal gap implies a separate visual column/block 
        // that shouldn't be merged into a single structural line.
        isCompatible = false;
      } else if (gapX < -opts.maximumHorizontalGapMultiplier * currentMaxHeight) {
         // Severe horizontal backtracking (e.g. overlapping text that wasn't caught by C.2)
         // We flag confidence drop if we merge heavily overlapping artifacts
         confidenceDrop = "low";
      }
    }

    if (isCompatible) {
      // Merge into current line
      currentLineIds.push(geom.id);
      
      // Expand bounds
      currentBounds!.left = Math.min(currentBounds!.left, geom.bounds.left);
      currentBounds!.bottom = Math.min(currentBounds!.bottom, geom.bounds.bottom);
      currentBounds!.right = Math.max(currentBounds!.right, geom.bounds.right);
      currentBounds!.top = Math.max(currentBounds!.top, geom.bounds.top);
      
      // Update running metrics gently
      currentCenterY = currentBounds!.bottom + (currentBounds!.top - currentBounds!.bottom) / 2;
      currentMaxHeight = Math.max(currentMaxHeight, geom.height);
      
      if (confidenceDrop && lineConfidence !== "low") {
        lineConfidence = confidenceDrop;
      }
    } else {
      // Finalize current line and start a new one
      pushLine();
      startNewLine(geom);
    }
  }

  // Push final line
  pushLine();

  return lines;
}
