import { PdfPoint } from "./coordinates";
import { EditorMutationIntent, createMoveIntent, createDeleteIntent } from "./mutation";

export type InteractionPhase = "idle" | "pointer_down" | "selecting" | "dragging";

export interface LayahEditorState {
  phase: InteractionPhase;
  activePage: number | null;
  selectedObjectIds: string[];
  dragStartPoint: PdfPoint | null;
  currentPointer: PdfPoint | null;
}

const DRAG_THRESHOLD_PT = 3;

export const INITIAL_EDITOR_STATE: LayahEditorState = {
  phase: "idle",
  activePage: null,
  selectedObjectIds: [],
  dragStartPoint: null,
  currentPointer: null,
};

/**
 * A purely deterministic state machine handling interaction logic
 * independently of the React view layer.
 */
export class InteractionStateMachine {
  private state: LayahEditorState;
  
  constructor(initialState: LayahEditorState = INITIAL_EDITOR_STATE) {
    this.state = { ...initialState, selectedObjectIds: [...initialState.selectedObjectIds] };
  }

  getState(): LayahEditorState {
    return { ...this.state, selectedObjectIds: [...this.state.selectedObjectIds] };
  }

  // --- Pointer Events ---

  /** Replace the selection programmatically (e.g. after a mutation reloads the model). */
  select(ids: string[], pageIndex: number | null = this.state.activePage): void {
    this.state.selectedObjectIds = [...ids];
    this.state.activePage = pageIndex;
  }

  /** Drop selection and any in-flight gesture. */
  reset(): void {
    this.state = { ...INITIAL_EDITOR_STATE, selectedObjectIds: [] };
  }

  /**
   * Layah ids (runs, blocks) are only unique per page, so selection never spans pages:
   * pressing on a different page than the current selection starts a fresh selection there.
   */
  pointerDown(point: PdfPoint, hitObjectId: string | null, isShift: boolean = false, pageIndex: number | null = null): void {
    if (this.state.phase !== "idle") return;
    if (pageIndex !== null && pageIndex !== this.state.activePage) {
      this.state.selectedObjectIds = [];
      this.state.activePage = pageIndex;
    }

    this.state.currentPointer = point;
    this.state.dragStartPoint = point;

    if (hitObjectId) {
      if (isShift) {
        // Toggle selection
        const idx = this.state.selectedObjectIds.indexOf(hitObjectId);
        if (idx === -1) {
          this.state.selectedObjectIds.push(hitObjectId);
        } else {
          this.state.selectedObjectIds.splice(idx, 1);
        }
      } else {
        // If clicking an unselected object without shift, select only it
        if (!this.state.selectedObjectIds.includes(hitObjectId)) {
          this.state.selectedObjectIds = [hitObjectId];
        }
      }
      this.state.phase = "pointer_down";
    } else {
      if (!isShift) {
        this.state.selectedObjectIds = [];
      }
      // Clicked on empty space -> start a rubber-band selection
      this.state.phase = "selecting";
    }
  }

  pointerMove(point: PdfPoint, dragThresholdPt: number = DRAG_THRESHOLD_PT): void {
    this.state.currentPointer = point;

    if (this.state.phase === "pointer_down" && this.state.dragStartPoint) {
      // Ignore jitter: a click must not become a 0.1pt move (and a history entry).
      const d = Math.hypot(point.x - this.state.dragStartPoint.x, point.y - this.state.dragStartPoint.y);
      if (d >= dragThresholdPt) this.state.phase = "dragging";
    }
  }

  pointerUp(): EditorMutationIntent | null {
    let intent: EditorMutationIntent | null = null;

    if (this.state.phase === "dragging" && this.state.dragStartPoint && this.state.currentPointer) {
      const deltaX = this.state.currentPointer.x - this.state.dragStartPoint.x;
      const deltaY = this.state.currentPointer.y - this.state.dragStartPoint.y;
      
      // Emit a move intent if there was actual movement
      if (deltaX !== 0 || deltaY !== 0) {
         intent = createMoveIntent([...this.state.selectedObjectIds], deltaX, deltaY);
      }
    }

    this.state.phase = "idle";
    this.state.dragStartPoint = null;
    return intent;
  }

  cancel(): void {
    this.state.phase = "idle";
    this.state.dragStartPoint = null;
    this.state.currentPointer = null;
  }

  // --- Keyboard Events ---

  keyDown(key: string): EditorMutationIntent | null {
    if (this.state.phase !== "idle") {
       if (key === "Escape") {
         this.cancel();
       }
       return null;
    }

    if ((key === "Delete" || key === "Backspace") && this.state.selectedObjectIds.length > 0) {
      const intent = createDeleteIntent([...this.state.selectedObjectIds]);
      // Note: we don't automatically clear selection here. 
      // The mutation applier should do that.
      return intent;
    }

    if (key === "Escape") {
      this.state.selectedObjectIds = [];
    }

    return null;
  }
}
