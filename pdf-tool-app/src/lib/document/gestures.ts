import type { PdfPoint } from "./coordinates";
import { hitTestPoint } from "./hittest";
import type { InteractionStateMachine } from "./interaction";
import type { EditorMutationIntent } from "./mutation";
import type { LayahPage } from "./types";

/**
 * Pointer-gesture seam between the page overlay (React) and the interaction state machine.
 * Pure: no React, no DOM, no session/engine. The overlay calls these; tests call the same functions.
 *
 * Invariant enforced here: the ONLY way a pointer gesture yields a document-changing intent is `gestureUp`
 * returning a "move" for a completed drag. Down/move/cancel/lost-capture never do.
 */

/** A press becomes a drag only after this many screen pixels (converted to PDF points via the zoom). */
export const DRAG_THRESHOLD_PX = 6;

/**
 * A completed drag whose total displacement is at most this many screen pixels is treated as "no movement" and
 * produces no intent. 0.25 CSS px is below what any pointer can express (finest granularity is one device pixel =
 * 0.33 CSS px at 3x DPR), so this only absorbs float noise and fractional jitter; every deliberate move is larger.
 */
export const NOOP_MOVE_TOLERANCE_PX = 0.25;

/** Rubber-band boxes smaller than this (PDF points) select nothing. Pre-existing value, unchanged. */
export const MARQUEE_MIN_PT = 4;

/** Everything on a page that a click can hit. Blocks lose area ties so a one-line block selects as its (editable) run. */
export function hitCandidates(page: LayahPage) {
  return [
    ...Object.values(page.layout.runs).map(r => ({ id: r.id, bounds: r.bounds })),
    ...Object.values(page.layout.textBlocks).map(b => ({
      id: b.id,
      bounds: b.bounds,
      area: (b.bounds.right - b.bounds.left) * (b.bounds.top - b.bounds.bottom) * 1.001 + 0.01,
    })),
    ...Object.values(page.objects).filter(o => o.type === "image").map(o => ({ id: o.id, bounds: o.bounds })),
  ];
}

/** Is a gesture in flight on this page? Reads the machine, not React props, so it can't be stale. */
const gestureActive = (m: InteractionStateMachine, pageIndex: number) => {
  const s = m.getState();
  return s.activePage === pageIndex && s.phase !== "idle";
};

export function gestureDown(m: InteractionStateMachine, page: LayahPage, pt: PdfPoint, shift: boolean): void {
  m.pointerDown(pt, hitTestPoint(pt, hitCandidates(page)), shift, page.pageIndex);
}

/** @returns whether a gesture is in flight (callers re-render only when true). */
export function gestureMove(m: InteractionStateMachine, pageIndex: number, pt: PdfPoint, zoom: number): boolean {
  if (!gestureActive(m, pageIndex)) return false;
  m.pointerMove(pt, DRAG_THRESHOLD_PX / zoom);
  return true;
}

/** Normal release. Applies marquee selection; returns a move intent only for a real, non-trivial drag. */
export function gestureUp(m: InteractionStateMachine, page: LayahPage, shift: boolean, zoom: number): EditorMutationIntent | null {
  if (!gestureActive(m, page.pageIndex)) return null;
  const st = m.getState();
  const intent = m.pointerUp();

  if (st.phase === "selecting" && st.dragStartPoint && st.currentPointer) {
    const a = st.dragStartPoint, b = st.currentPointer;
    if (Math.hypot(a.x - b.x, a.y - b.y) > MARQUEE_MIN_PT) {
      const box = { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), bottom: Math.min(a.y, b.y), top: Math.max(a.y, b.y) };
      const hit = [
        ...Object.values(page.layout.runs),
        ...Object.values(page.objects).filter(o => o.type === "image"),
      ].filter(o => o.bounds.left < box.right && o.bounds.right > box.left && o.bounds.bottom < box.top && o.bounds.top > box.bottom).map(o => o.id);
      m.select([...new Set([...(shift ? st.selectedObjectIds : []), ...hit])], page.pageIndex);
    }
  }

  if (intent?.type === "move" && Math.hypot(intent.deltaX, intent.deltaY) <= NOOP_MOVE_TOLERANCE_PX / zoom) return null;
  return intent;
}

/**
 * pointercancel / lostpointercapture: discard the pending gesture. Never yields an intent; selection made by the
 * press itself is kept. Safe when idle (lostpointercapture also fires after every normal release).
 */
export function gestureCancel(m: InteractionStateMachine, pageIndex: number): void {
  if (gestureActive(m, pageIndex)) m.cancel();
}

/** Ctrl/Cmd+A: every run and image on the page. Selection only. */
export function selectAllOnPage(m: InteractionStateMachine, page: LayahPage): void {
  m.select([
    ...Object.keys(page.layout.runs),
    ...Object.values(page.objects).filter(o => o.type === "image").map(o => o.id),
  ], page.pageIndex);
}
