import { LayahSourceObject, LayahObjectBounds } from "./types";
import { LayahTextLine } from "./lines";
import { LayahTextRun } from "./runs";
import { LayahTextBlock } from "./blocks";

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
}

export interface ValidationReport {
  valid: boolean; // True if no errors. Warnings do not invalidate the model.
  issues: ValidationIssue[];
  stats: {
    sourceCount: number;
    lineCount: number;
    runCount: number;
    blockCount: number;
    orphanedSourceCount: number;
  };
}

const EPSILON = 0.5; // Acceptable float rounding error for bound containment

function isFiniteNumber(val: any): boolean {
  return typeof val === "number" && Number.isFinite(val);
}

function validateBounds(bounds: LayahObjectBounds, nodeId: string, issues: ValidationIssue[]) {
  if (!bounds) {
    issues.push({ level: "error", code: "MISSING_BOUNDS", message: "Missing bounds", nodeId });
    return;
  }
  if (!isFiniteNumber(bounds.left) || !isFiniteNumber(bounds.right) || !isFiniteNumber(bounds.top) || !isFiniteNumber(bounds.bottom)) {
    issues.push({ level: "error", code: "NON_FINITE_BOUNDS", message: "Bounds contain non-finite numbers", nodeId });
    return;
  }
  if (bounds.left > bounds.right) {
    issues.push({ level: "error", code: "INVALID_WIDTH", message: `Left (${bounds.left}) > Right (${bounds.right})`, nodeId });
  }
  if (bounds.bottom > bounds.top) {
    issues.push({ level: "error", code: "INVALID_HEIGHT", message: `Bottom (${bounds.bottom}) > Top (${bounds.top})`, nodeId });
  }
}

function containsBounds(parent: LayahObjectBounds, child: LayahObjectBounds): boolean {
  return (
    child.left >= parent.left - EPSILON &&
    child.right <= parent.right + EPSILON &&
    child.bottom >= parent.bottom - EPSILON &&
    child.top <= parent.top + EPSILON
  );
}

export function validateDocumentModel(
  sourceObjects: LayahSourceObject[],
  lines: LayahTextLine[],
  runs: LayahTextRun[],
  blocks: LayahTextBlock[]
): ValidationReport {
  const issues: ValidationIssue[] = [];
  
  // 1. ID Integrity (Dictionaries)
  const sourceMap = new Map<string, LayahSourceObject>();
  const lineMap = new Map<string, LayahTextLine>();
  const runMap = new Map<string, LayahTextRun>();
  const blockMap = new Map<string, LayahTextBlock>();

  const checkDuplicates = (items: any[], map: Map<string, any>, type: string) => {
    for (const item of items) {
      if (map.has(item.id)) {
        issues.push({ level: "error", code: "DUPLICATE_ID", message: `Duplicate ${type} ID`, nodeId: item.id });
      }
      map.set(item.id, item);
    }
  };

  checkDuplicates(sourceObjects, sourceMap, "source object");
  checkDuplicates(lines, lineMap, "line");
  checkDuplicates(runs, runMap, "run");
  checkDuplicates(blocks, blockMap, "block");

  // Track Coverage
  const referencedSourceIds = new Set<string>();

  // 2. Lines Validation
  for (const line of lines) {
    validateBounds(line.bounds, line.id, issues);
    if (line.sourceObjectIds.length === 0) {
      issues.push({ level: "error", code: "EMPTY_LINE", message: "Line contains no source objects", nodeId: line.id });
    }

    for (const sourceId of line.sourceObjectIds) {
      referencedSourceIds.add(sourceId);
      const sourceObj = sourceMap.get(sourceId);
      if (!sourceObj) {
        issues.push({ level: "error", code: "MISSING_SOURCE_REF", message: `Line references missing source object`, nodeId: line.id });
      } else {
        if (sourceObj.pageIndex !== line.pageIndex) {
          issues.push({ level: "error", code: "PAGE_INCONSISTENCY", message: `Line on page ${line.pageIndex} references object on page ${sourceObj.pageIndex}`, nodeId: line.id });
        }
        if (!containsBounds(line.bounds, sourceObj.bounds)) {
          issues.push({ level: "error", code: "GEOMETRY_ESCAPED", message: `Line bounds do not contain source object ${sourceId}`, nodeId: line.id });
        }
      }
    }
  }

  // 3. Runs Validation
  for (const run of runs) {
    validateBounds(run.bounds, run.id, issues);
    if (run.sourceObjectIds.length === 0) {
      issues.push({ level: "error", code: "EMPTY_RUN", message: "Run contains no source objects", nodeId: run.id });
    }

    for (const sourceId of run.sourceObjectIds) {
      const sourceObj = sourceMap.get(sourceId);
      if (!sourceObj) {
        issues.push({ level: "error", code: "MISSING_SOURCE_REF", message: `Run references missing source object`, nodeId: run.id });
      } else {
        if (sourceObj.pageIndex !== run.pageIndex) {
          issues.push({ level: "error", code: "PAGE_INCONSISTENCY", message: `Run on page ${run.pageIndex} references object on page ${sourceObj.pageIndex}`, nodeId: run.id });
        }
        if (!containsBounds(run.bounds, sourceObj.bounds)) {
          issues.push({ level: "error", code: "GEOMETRY_ESCAPED", message: `Run bounds do not contain source object ${sourceId}`, nodeId: run.id });
        }
      }
    }
  }

  // 4. Blocks Validation
  for (const block of blocks) {
    validateBounds(block.bounds, block.id, issues);
    if (block.lineIds.length === 0) {
      issues.push({ level: "error", code: "EMPTY_BLOCK", message: "Block contains no lines", nodeId: block.id });
    }

    for (const lineId of block.lineIds) {
      const line = lineMap.get(lineId);
      if (!line) {
        issues.push({ level: "error", code: "MISSING_LINE_REF", message: `Block references missing line`, nodeId: block.id });
      } else {
        if (line.pageIndex !== block.pageIndex) {
          issues.push({ level: "error", code: "PAGE_INCONSISTENCY", message: `Block on page ${block.pageIndex} references line on page ${line.pageIndex}`, nodeId: block.id });
        }
        if (!containsBounds(block.bounds, line.bounds)) {
          issues.push({ level: "error", code: "GEOMETRY_ESCAPED", message: `Block bounds do not contain line ${lineId}`, nodeId: block.id });
        }
      }
    }
  }

  // 5. Source Geometry Sanity
  let textSourceCount = 0;
  for (const src of sourceObjects) {
    validateBounds(src.bounds, src.id, issues);
    if (src.type === "text") {
      textSourceCount++;
      if (!referencedSourceIds.has(src.id)) {
        issues.push({ level: "warning", code: "ORPHANED_SOURCE", message: "Text source object not claimed by any line", nodeId: src.id });
      }
    }
  }

  const hasErrors = issues.some(i => i.level === "error");

  return {
    valid: !hasErrors,
    issues,
    stats: {
      sourceCount: sourceObjects.length,
      lineCount: lines.length,
      runCount: runs.length,
      blockCount: blocks.length,
      orphanedSourceCount: textSourceCount - referencedSourceIds.size,
    }
  };
}
