import { LayahObjectBounds } from "./types";
import { NormalizedTextGeometry } from "./geometry";
import { LayahTextLine } from "./lines";

export interface LayahTextRun {
  id: string;
  pageIndex: number;
  sourceObjectIds: string[];
  bounds: LayahObjectBounds;
  fontSize?: number;
  fontWeight?: number;
  isItalic?: boolean;
}

export interface TextRunInferenceOptions {
  /** Maximum difference in font size (in points) to still be considered the same text run */
  fontSizeTolerance: number;
  /** Maximum baseline/center-Y shift (relative to max height) before assuming a superscript/subscript split */
  verticalOffsetToleranceRatio: number;
  /** Maximum horizontal gap multiplier (relative to height) before splitting runs to represent large tab/spacing gaps within a line */
  spacingToleranceMultiplier: number;
}

export const DEFAULT_RUN_OPTIONS: TextRunInferenceOptions = {
  fontSizeTolerance: 1.0,
  verticalOffsetToleranceRatio: 0.3,
  spacingToleranceMultiplier: 2.5,
};

/**
 * Infers explicit TextRuns from TextLines.
 * A run groups source objects within a line that share compatible visual/text-rendering characteristics.
 */
export function inferTextRuns(
  lines: LayahTextLine[],
  geometries: NormalizedTextGeometry[],
  options: Partial<TextRunInferenceOptions> = {}
): LayahTextRun[] {
  const opts = { ...DEFAULT_RUN_OPTIONS, ...options };
  const runs: LayahTextRun[] = [];

  const geomMap = new Map<string, NormalizedTextGeometry>();
  for (const g of geometries) {
    geomMap.set(g.id, g);
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.sourceObjectIds.length === 0) continue;

    let currentRunIds: string[] = [];
    let currentBounds: LayahObjectBounds | null = null;
    let currentFontSize: number | undefined;
    let currentFontWeight: number | undefined;
    let currentIsItalic: boolean | undefined;
    let currentCenterY = 0;
    let currentMaxHeight = 0;

    const pushRun = () => {
      if (currentRunIds.length > 0 && currentBounds) {
        runs.push({
          id: `run-${lineIndex + 1}-${runs.length + 1}`,
          pageIndex: line.pageIndex,
          sourceObjectIds: [...currentRunIds],
          bounds: { ...currentBounds },
          fontSize: currentFontSize,
          fontWeight: currentFontWeight,
          isItalic: currentIsItalic,
        });
      }
    };

    const startNewRun = (geom: NormalizedTextGeometry) => {
      currentRunIds = [geom.id];
      currentBounds = { ...geom.bounds };
      currentFontSize = geom.fontSize;
      currentFontWeight = geom.fontWeight;
      currentIsItalic = geom.isItalic;
      currentCenterY = geom.centerY;
      currentMaxHeight = geom.height;
    };

    for (const id of line.sourceObjectIds) {
      const geom = geomMap.get(id);
      if (!geom) continue;

      if (currentRunIds.length === 0) {
        startNewRun(geom);
        continue;
      }

      let isCompatible = true;

      // 1. Check Font Size match
      if (geom.fontSize !== undefined && currentFontSize !== undefined) {
        if (Math.abs(geom.fontSize - currentFontSize) > opts.fontSizeTolerance) {
          isCompatible = false;
        }
      } else if ((geom.fontSize === undefined) !== (currentFontSize === undefined)) {
        // One has font size, other doesn't
        // We can fallback to height heuristic if strict font metadata isn't reliable,
        // but let's be strict for runs.
        const heightDiff = Math.abs(geom.height - currentMaxHeight);
        if (heightDiff > opts.fontSizeTolerance + 1) {
          isCompatible = false;
        }
      }

      // 2. Check Weight / Italic
      if (geom.fontWeight !== currentFontWeight) isCompatible = false;
      if (geom.isItalic !== currentIsItalic) isCompatible = false;

      // 3. Check Baseline Shift (Superscript/Subscript detection)
      if (isCompatible) {
        const yDiff = Math.abs(geom.centerY - currentCenterY);
        const maxHeight = Math.max(currentMaxHeight, geom.height);
        if (maxHeight > 0 && (yDiff / maxHeight) > opts.verticalOffsetToleranceRatio) {
          isCompatible = false; // Sudden vertical shift
        }
      }

      // 4. Check Spacing Jump (Large gap within a line should break runs)
      if (isCompatible) {
        const gapX = geom.bounds.left - currentBounds!.right;
        const maxGap = Math.max(opts.spacingToleranceMultiplier * currentMaxHeight, 15);
        if (gapX > maxGap) {
          isCompatible = false;
        }
      }

      if (isCompatible) {
        currentRunIds.push(geom.id);
        
        currentBounds!.left = Math.min(currentBounds!.left, geom.bounds.left);
        currentBounds!.bottom = Math.min(currentBounds!.bottom, geom.bounds.bottom);
        currentBounds!.right = Math.max(currentBounds!.right, geom.bounds.right);
        currentBounds!.top = Math.max(currentBounds!.top, geom.bounds.top);
        
        // Slightly blend the metrics
        if (geom.fontSize !== undefined) {
          currentFontSize = currentFontSize === undefined ? geom.fontSize : (currentFontSize + geom.fontSize) / 2;
        }
        currentCenterY = currentBounds!.bottom + (currentBounds!.top - currentBounds!.bottom) / 2;
        currentMaxHeight = Math.max(currentMaxHeight, geom.height);
      } else {
        pushRun();
        startNewRun(geom);
      }
    }

    pushRun();
  }

  return runs;
}
