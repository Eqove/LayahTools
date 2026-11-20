/**
 * Viewer navigation (zoom and pan). Pure logic, no DOM, no document access: navigation only ever changes the
 * viewer's scale and scroll position, never the PDF. `PdfViewer` translates DOM events into these calls.
 *
 * Contract:
 * - Ctrl/Cmd + wheel (and trackpad pinch, which browsers deliver as ctrl+wheel) zooms around the pointer; the
 *   document point under the cursor stays under the cursor. Plain wheel / two-finger scroll is left to the browser.
 * - Zoom is clamped to [ZOOM_MIN, ZOOM_MAX]. +/- step by ZOOM_STEP. Fit Width / Fit Page compute a zoom for the
 *   current page and the visible area.
 * - Pan: middle-button drag, or left drag while Space is held. A pan press is claimed before the page overlay sees
 *   it, so it can never select, marquee, move an object or mutate the document. The active tool is unchanged.
 * - Releasing Space or pressing Escape ends the pan; the rest of that press is inert (its release does nothing).
 *   pointercancel / lostpointercapture / window blur end it immediately.
 * - Hand tool (`hand = true`): a plain left drag pans too, until another tool is chosen; Space release does not end it.
 * - Zoom never blanks a page: react-pdf clears and hides each canvas while it re-renders at the new scale, so the
 *   viewer keeps a stretched copy of the last finished render under it (see `keepBackdrop` / `isCurrentRender`).
 */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 1000) / 1000));

/** New zoom for one wheel event. Multiplicative so mouse notches and small pinch deltas both feel even. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
  const d = Math.max(-100, Math.min(100, px)); // one mouse notch (100px) = ~16%; ignore runaway deltas
  return clampZoom(zoom * Math.exp(-d * 0.0015));
}

export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

/** Zoom at which a page (in PDF points, i.e. CSS px at zoom 1) fits the visible area's width, or entirely. */
export function fitZoom(mode: "width" | "page", page: Size, area: Size): number {
  const w = area.width / page.width;
  return clampZoom(mode === "width" ? w : Math.min(w, area.height / page.height));
}

/** Where `p` sits inside `r`, as fractions of its size (outside the rect gives values beyond 0..1). */
export const fractionIn = (p: Point, r: Rect): Point => ({ x: (p.x - r.left) / r.width, y: (p.y - r.top) / r.height });

/**
 * Scroll position that puts fraction `f` of the (re-laid-out) page rect `after` back under client point `p`.
 * `after` is in client coordinates measured at the current scroll; the browser clamps the result to its range.
 */
export function anchoredScroll(scroll: { left: number; top: number }, p: Point, after: Rect, f: Point) {
  return { left: scroll.left + after.left + f.x * after.width - p.x, top: scroll.top + after.top + f.y * after.height - p.y };
}

type PanPhase = "idle" | "panning" | "inert";

/** Temporary pan state. One instance per viewer. */
export class PanController {
  spaceHeld = false;
  /** Hand tool active: left drag pans without Space. */
  hand = false;
  phase: PanPhase = "idle";
  private pointerId: number | null = null;
  private viaSpace = false;
  private last: Point = { x: 0, y: 0 };

  /** Space pressed (caller decides eligibility: pointer over the viewer, not typing). Returns true if handled. */
  keyDown(key: string): boolean {
    if (key !== " ") return false;
    this.spaceHeld = true;
    return true;
  }

  keyUp(key: string): boolean {
    if (key !== " ") return false;
    this.spaceHeld = false;
    if (this.phase === "panning" && this.viaSpace) this.phase = "inert"; // Space-pan ends with Space
    return true;
  }

  /** Escape ends an active pan. Returns true when it did (the caller should then swallow the key). */
  escape(): boolean {
    if (this.phase !== "panning") return false;
    this.phase = "inert";
    return true;
  }

  /** Whether this press belongs to navigation (and must not reach the page overlay). */
  down(pointerId: number, button: number, p: Point): boolean {
    if (this.phase !== "idle") return true; // another button during a pan: swallow it
    if (!(button === 1 || (button === 0 && (this.spaceHeld || this.hand)))) return false;
    this.phase = "panning";
    this.pointerId = pointerId;
    this.viaSpace = button === 0 && !this.hand;
    this.last = p;
    return true;
  }

  owns(pointerId: number): boolean { return this.phase !== "idle" && pointerId === this.pointerId; }

  /** Scroll delta to apply for this move (content follows the pointer), or null if nothing should scroll. */
  drag(pointerId: number, p: Point): Point | null {
    if (this.phase !== "panning" || pointerId !== this.pointerId) return null;
    const d = { x: this.last.x - p.x, y: this.last.y - p.y };
    this.last = p;
    return d;
  }

  /** Release. Returns true if the press was navigation's (caller swallows it). */
  up(pointerId: number): boolean {
    if (!this.owns(pointerId)) return false;
    this.reset();
    return true;
  }

  /** pointercancel / lostpointercapture: end immediately. */
  cancel(pointerId?: number): void {
    if (pointerId === undefined || this.owns(pointerId)) this.reset();
  }

  /** Window lost focus: the Space keyup will never arrive. */
  blur(): void { this.spaceHeld = false; this.reset(); }

  private reset() { this.phase = "idle"; this.pointerId = null; this.viaSpace = false; }
}

/**
 * Before a zoom change: should this page get a copy of its current canvas as a backdrop? Only when the canvas holds a
 * finished render (react-pdf hides it while drawing, and its bitmap is then blank), and only for pages on screen, so
 * at most a screenful of extra bitmaps exists. An existing backdrop is kept: it is still the last good frame.
 */
export const keepBackdrop = (o: { canvasRendered: boolean; hasBackdrop: boolean; onScreen: boolean }) =>
  o.onScreen && o.canvasRendered && !o.hasBackdrop;

/** A finished render belongs to the current zoom (an older, superseded scale must not remove the backdrop). */
export const isCurrentRender = (renderedScale: number, zoom: number) => Math.abs(renderedScale - zoom) < 1e-3;
