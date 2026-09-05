import { LayahDocument, LayahSourceObject, LayahObjectBounds, LayahTransform } from "./types";

export type LayahIdentityConfidence = "intrinsic" | "derived" | "positional" | "uncertain";

export interface MatchedObject {
  oldId: string;
  newId: string;
  confidence: LayahIdentityConfidence;
  reason: string;
}

export interface UncertainObject {
  oldId: string;
  candidateIds: string[];
  reason: string;
}

export interface ReconciliationReport {
  matched: MatchedObject[];
  added: string[];
  removed: string[];
  uncertain: UncertainObject[];
}

const EPSILON = 0.001;

function isClose(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function isExactBounds(b1: LayahObjectBounds, b2: LayahObjectBounds): boolean {
  return (
    isClose(b1.left, b2.left) &&
    isClose(b1.bottom, b2.bottom) &&
    isClose(b1.right, b2.right) &&
    isClose(b1.top, b2.top)
  );
}

function isExactTransform(t1: LayahTransform | null, t2: LayahTransform | null): boolean {
  if (t1 === null && t2 === null) return true;
  if (t1 === null || t2 === null) return false;
  return (
    isClose(t1.a, t2.a) &&
    isClose(t1.b, t2.b) &&
    isClose(t1.c, t2.c) &&
    isClose(t1.d, t2.d) &&
    isClose(t1.e, t2.e) &&
    isClose(t1.f, t2.f)
  );
}

function calculateArea(b: LayahObjectBounds): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.top - b.bottom);
}

function calculateOverlapRatio(b1: LayahObjectBounds, b2: LayahObjectBounds): number {
  const overlapLeft = Math.max(b1.left, b2.left);
  const overlapRight = Math.min(b1.right, b2.right);
  const overlapBottom = Math.max(b1.bottom, b2.bottom);
  const overlapTop = Math.min(b1.top, b2.top);

  if (overlapRight <= overlapLeft || overlapTop <= overlapBottom) return 0;

  const overlapArea = (overlapRight - overlapLeft) * (overlapTop - overlapBottom);
  const minArea = Math.min(calculateArea(b1), calculateArea(b2));
  
  if (minArea === 0) return 0;
  return overlapArea / minArea;
}

export function reconcileDocuments(oldDoc: LayahDocument, newDoc: LayahDocument): ReconciliationReport {
  const report: ReconciliationReport = {
    matched: [],
    added: [],
    removed: [],
    uncertain: [],
  };

  // We reconcile page by page. If a page was added/removed, we handle it gracefully.
  const oldPageIndices = Object.keys(oldDoc.pages).map(Number);
  const newPageIndices = Object.keys(newDoc.pages).map(Number);

  const allPageIndices = new Set([...oldPageIndices, ...newPageIndices]);

  for (const pageIndex of allPageIndices) {
    const oldPage = oldDoc.pages[pageIndex];
    const newPage = newDoc.pages[pageIndex];

    if (oldPage && !newPage) {
      report.removed.push(...Object.keys(oldPage.objects));
    } else if (!oldPage && newPage) {
      report.added.push(...Object.keys(newPage.objects));
    } else if (oldPage && newPage) {
      const pageReport = reconcilePageObjects(oldPage.objects, newPage.objects);
      report.matched.push(...pageReport.matched);
      report.added.push(...pageReport.added);
      report.removed.push(...pageReport.removed);
      report.uncertain.push(...pageReport.uncertain);
    }
  }

  return report;
}

export function reconcilePageObjects(
  oldObjectsMap: Record<string, LayahSourceObject>,
  newObjectsMap: Record<string, LayahSourceObject>
): ReconciliationReport {
  const unmatchedOld = new Set(Object.values(oldObjectsMap));
  const unmatchedNew = new Set(Object.values(newObjectsMap));

  const matched: MatchedObject[] = [];
  const uncertain: UncertainObject[] = [];

  const match = (oldObj: LayahSourceObject, newObj: LayahSourceObject, confidence: LayahIdentityConfidence, reason: string) => {
    matched.push({ oldId: oldObj.id, newId: newObj.id, confidence, reason });
    unmatchedOld.delete(oldObj);
    unmatchedNew.delete(newObj);
  };

  // Pass 1: Exact Derived Matches (Same type, geometry, transform, and text content)
  for (const oldObj of Array.from(unmatchedOld)) {
    const exactCandidates = Array.from(unmatchedNew).filter((newObj) => {
      if (oldObj.type !== newObj.type) return false;
      if (!isExactBounds(oldObj.bounds, newObj.bounds)) return false;
      if (!isExactTransform(oldObj.transform, newObj.transform)) return false;
      if (oldObj.type === "text" && newObj.type === "text") {
        if (oldObj.text !== newObj.text) return false;
      }
      return true;
    });

    if (exactCandidates.length === 1) {
      match(oldObj, exactCandidates[0], "derived", "Exact geometry and content match");
    } else if (exactCandidates.length > 1) {
      // Duplicates in exact same spot (rare but possible in PDF). 
      // We will let positional fallback catch them if possible, otherwise they become uncertain.
    }
  }

  // Pass 2: Unique Content Match (Geometry mutated, but text is unique on page)
  for (const oldObj of Array.from(unmatchedOld)) {
    if (oldObj.type !== "text") continue;

    const contentCandidates = Array.from(unmatchedNew).filter((newObj) => {
      return newObj.type === "text" && newObj.text === oldObj.text;
    });

    if (contentCandidates.length === 1) {
      match(oldObj, contentCandidates[0], "derived", "Unique text content match with mutated geometry");
    }
  }

  // Pass 3: Exact Geometry Match (Content mutated, but bounds/transform are strictly untouched)
  for (const oldObj of Array.from(unmatchedOld)) {
    const geometryCandidates = Array.from(unmatchedNew).filter((newObj) => {
      return (
        oldObj.type === newObj.type &&
        isExactBounds(oldObj.bounds, newObj.bounds) &&
        isExactTransform(oldObj.transform, newObj.transform)
      );
    });

    if (geometryCandidates.length === 1) {
      match(oldObj, geometryCandidates[0], "derived", "Exact geometry match with mutated content");
    }
  }

  // Pass 4: Spatial Overlap Match (Slight shifts in layout due to re-rendering)
  for (const oldObj of Array.from(unmatchedOld)) {
    const overlapCandidates = Array.from(unmatchedNew).filter((newObj) => {
      if (oldObj.type !== newObj.type) return false;
      return calculateOverlapRatio(oldObj.bounds, newObj.bounds) > 0.5;
    });

    if (overlapCandidates.length === 1) {
      match(oldObj, overlapCandidates[0], "positional", "Significant spatial overlap match");
    } else if (overlapCandidates.length > 1) {
      uncertain.push({
        oldId: oldObj.id,
        candidateIds: overlapCandidates.map(c => c.id),
        reason: "Multiple candidates with spatial overlap"
      });
      unmatchedOld.delete(oldObj);
    }
  }

  // Pass 5: Positional ID Fallback (Same ID generated by PDFium mapper sequence)
  for (const oldObj of Array.from(unmatchedOld)) {
    const idCandidate = Array.from(unmatchedNew).find((newObj) => newObj.id === oldObj.id);
    if (idCandidate) {
      // Only accept this if they are the same type to be safe
      if (idCandidate.type === oldObj.type) {
        match(oldObj, idCandidate, "positional", "Positional sequence ID fallback");
      }
    }
  }

  // Collect additions and removals
  const added = Array.from(unmatchedNew).map(obj => obj.id);
  const removed = Array.from(unmatchedOld).map(obj => obj.id);

  return {
    matched,
    added,
    removed,
    uncertain
  };
}
