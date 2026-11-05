import { LayahObjectBounds } from "./types";
import { LayahTextLine } from "./lines";

export interface LayahTextBlock {
  id: string;
  pageIndex: number;
  lineIds: string[];
  bounds: LayahObjectBounds;
  confidence: "high" | "medium" | "low";
}

export interface TextBlockInferenceOptions {
  /** Maximum vertical gap (multiplier of line height) before splitting blocks */
  maximumLineSpacingMultiplier: number;
  /** Maximum horizontal shift/indentation (multiplier of line height) before splitting blocks */
  maximumIndentationMultiplier: number;
  /** If the next line jumps vertically UP by more than this (points), split block (indicates new column/region) */
  columnJumpTolerance: number;
}

export const DEFAULT_BLOCK_OPTIONS: TextBlockInferenceOptions = {
  maximumLineSpacingMultiplier: 2.0,
  maximumIndentationMultiplier: 4.0,
  columnJumpTolerance: 10,
};

/**
 * Infers spatially coherent groups of text lines called Text Blocks.
 */
export function inferTextBlocks(
  lines: LayahTextLine[],
  options: Partial<TextBlockInferenceOptions> = {}
): LayahTextBlock[] {
  const opts = { ...DEFAULT_BLOCK_OPTIONS, ...options };
  const blocks: LayahTextBlock[] = [];

  let currentLineIds: string[] = [];
  let currentBounds: LayahObjectBounds | null = null;
  let currentConfidence: "high" | "medium" | "low" = "high";
  let currentPageIndex = -1;
  let lastLineCenterY = 0;
  let lastLineHeight = 0;
  let lastLineTop = 0;
  let lastLineBottom = 0;

  const pushBlock = () => {
    if (currentLineIds.length > 0 && currentBounds) {
      blocks.push({
        id: `block-${blocks.length + 1}`,
        pageIndex: currentPageIndex,
        lineIds: [...currentLineIds],
        bounds: { ...currentBounds },
        confidence: currentConfidence,
      });
    }
  };

  const startNewBlock = (line: LayahTextLine, lineHeight: number, centerY: number) => {
    currentLineIds = [line.id];
    currentBounds = { ...line.bounds };
    currentPageIndex = line.pageIndex;
    currentConfidence = line.confidence; // inherit initial confidence
    lastLineCenterY = centerY;
    lastLineHeight = lineHeight;
    lastLineTop = line.bounds.top;
    lastLineBottom = line.bounds.bottom;
  };

  for (const line of lines) {
    const lineHeight = line.bounds.top - line.bounds.bottom;
    const centerY = line.bounds.bottom + lineHeight / 2;

    if (currentLineIds.length === 0) {
      startNewBlock(line, lineHeight, centerY);
      continue;
    }

    let isCompatible = true;
    let confidenceDrop: "medium" | "low" | null = null;

    // 1. Page Match
    if (line.pageIndex !== currentPageIndex) {
      isCompatible = false;
    }

    // 2. Column/Region Jump (Negative vertical gap)
    // If the new line's center is significantly higher than the last line's center,
    // we have jumped to the top of a new column/region.
    if (isCompatible && centerY > lastLineCenterY + opts.columnJumpTolerance) {
      isCompatible = false;
    }

    // 3. Vertical Gap
    if (isCompatible) {
      // Gap between bottom of last line and top of current line.
      // Remember Y increases upward, so bottom is smaller than top.
      const vGap = lastLineBottom - line.bounds.top;
      const avgHeight = (lastLineHeight + lineHeight) / 2;
      
      // If gap is highly negative (lines overlapping vertically heavily), flag confidence
      if (vGap < -avgHeight) {
        confidenceDrop = "low";
      }

      if (vGap > avgHeight * opts.maximumLineSpacingMultiplier) {
        isCompatible = false;
      }
    }

    // 4. Horizontal Indentation/Displacement
    if (isCompatible) {
      const hShiftLeft = Math.abs(line.bounds.left - currentBounds!.left);
      const hShiftRight = Math.abs(line.bounds.right - currentBounds!.right);
      const avgHeight = (lastLineHeight + lineHeight) / 2;

      // Allow either strong left alignment, strong right alignment, or strong overlap
      // If the left edge shifts massively, it might be a new block (e.g. quote block or separate column)
      // We check if it is completely outside the horizontal bounds of the block
      const isCompletelyDisjoint = line.bounds.right < currentBounds!.left || line.bounds.left > currentBounds!.right;
      
      if (isCompletelyDisjoint) {
        isCompatible = false;
      } else if (hShiftLeft > avgHeight * opts.maximumIndentationMultiplier && hShiftRight > avgHeight * opts.maximumIndentationMultiplier) {
        // Significantly shifted on both edges (e.g. centered text changing width drastically? Or an isolated floating block).
        // For spatial coherence, we'll split if the left edge shifts too much.
        isCompatible = false;
      }
    }

    if (isCompatible) {
      // Inherit low confidence from lines
      if (line.confidence === "low" || confidenceDrop === "low") currentConfidence = "low";
      else if (line.confidence === "medium" && currentConfidence === "high") currentConfidence = "medium";
      else if (confidenceDrop === "medium" && currentConfidence === "high") currentConfidence = "medium";

      currentLineIds.push(line.id);
      
      currentBounds!.left = Math.min(currentBounds!.left, line.bounds.left);
      currentBounds!.bottom = Math.min(currentBounds!.bottom, line.bounds.bottom);
      currentBounds!.right = Math.max(currentBounds!.right, line.bounds.right);
      currentBounds!.top = Math.max(currentBounds!.top, line.bounds.top);

      lastLineCenterY = centerY;
      lastLineHeight = lineHeight;
      lastLineTop = line.bounds.top;
      lastLineBottom = line.bounds.bottom;
    } else {
      pushBlock();
      startNewBlock(line, lineHeight, centerY);
    }
  }

  pushBlock();
  return blocks;
}
