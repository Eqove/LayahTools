import React from 'react';
import { ViewportBounds } from "../../../lib/document/coordinates";

export interface SelectedObjectItem {
  id: string;
  bounds: ViewportBounds;
  text?: string;
  type?: "text" | "image" | "rect" | "other";
}

export interface SelectionOverlayProps {
  /** Bounds of currently selected objects, converted to Viewport pixels */
  selectedObjectBounds: SelectedObjectItem[];

  /**
   * A single bounding box encompassing all selected items,
   * useful for rendering a group resize/move handle box.
   */
  groupSelectionBounds?: ViewportBounds | null;

  /** Highlight bounds for hovering, if applicable */
  hoverBounds?: ViewportBounds | null;

  /** Active phase */
  phase: "idle" | "pointer_down" | "selecting" | "dragging";

  /** The rubber-band selection box if currently selecting */
  selectionBox?: ViewportBounds | null;

  /** Current drag delta in PDF points for display */
  dragDeltaPt?: { x: number; y: number } | null;
}

/**
 * Renders absolutely positioned bounding boxes, drag ghost and marquee
 * over the PDF.js viewport.
 */
export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  selectedObjectBounds,
  groupSelectionBounds,
  hoverBounds,
  phase,
  selectionBox,
  dragDeltaPt,
}) => {
  // For single selection, show corner handles on the selected object box
  const singleBounds = selectedObjectBounds.length === 1 ? selectedObjectBounds[0].bounds : null;
  // For multi-selection use the group bounds
  const handleBounds = selectedObjectBounds.length > 1 ? groupSelectionBounds : singleBounds;
  const isDragging = phase === "dragging";

  return (
    <div className="absolute inset-0 pointer-events-none z-50">
      {/* 1. Hover highlight (idle only) */}
      {hoverBounds && phase === "idle" && (
        <div
          className="absolute border border-blue-300 bg-blue-100 bg-opacity-20 pointer-events-none"
          style={{
            left: hoverBounds.left,
            top: hoverBounds.top,
            width: hoverBounds.right - hoverBounds.left,
            height: hoverBounds.bottom - hoverBounds.top,
          }}
        />
      )}

      {/* 2. Individual selection highlights & Ghost Preview */}
      {selectedObjectBounds.map(({ id, bounds, text, type }) => (
        <div
          key={id}
          className={`absolute pointer-events-none overflow-hidden transition-none ${
            isDragging
              ? "border-2 border-blue-600 border-dashed bg-white/85 shadow-lg rounded-sm"
              : "border border-blue-500 bg-blue-200/30"
          }`}
          style={{
            left: bounds.left,
            top: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
          }}
        >
          {/* Ghost text preview while dragging */}
          {isDragging && text && (
            <div className="px-1 text-[11px] leading-tight text-slate-800 font-medium select-none truncate">
              {text}
            </div>
          )}
          {/* Ghost image indicator */}
          {isDragging && type === "image" && (
            <div className="w-full h-full flex items-center justify-center bg-blue-50/80 text-blue-600 text-xs font-medium">
              🖼 Image
            </div>
          )}
        </div>
      ))}

      {/* 3. Group outline (multi-select) */}
      {groupSelectionBounds && selectedObjectBounds.length > 1 && (
        <div
          className={`absolute pointer-events-none ${
            isDragging
              ? "border-2 border-blue-600 border-dashed shadow-md"
              : "border-2 border-blue-600"
          }`}
          style={{
            left: groupSelectionBounds.left,
            top: groupSelectionBounds.top,
            width: groupSelectionBounds.right - groupSelectionBounds.left,
            height: groupSelectionBounds.bottom - groupSelectionBounds.top,
          }}
        />
      )}

      {/* 4. Live Drag Delta Badge */}
      {isDragging && handleBounds && (
        <div
          className="absolute bg-blue-600 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap z-50 flex items-center gap-1"
          style={{
            left: handleBounds.left,
            top: Math.max(4, handleBounds.top - 22),
          }}
        >
          <span>Moving</span>
          {dragDeltaPt && (
            <span className="opacity-90">
              ({dragDeltaPt.x >= 0 ? `+${Math.round(dragDeltaPt.x)}` : Math.round(dragDeltaPt.x)}pt, {dragDeltaPt.y >= 0 ? `+${Math.round(dragDeltaPt.y)}` : Math.round(dragDeltaPt.y)}pt)
            </span>
          )}
        </div>
      )}

      {/* Resize handles intentionally not rendered: they were non-interactive. Re-add with real resize (P2). */}

      {/* 6. Rubber-band marquee (while selecting) */}
      {phase === "selecting" && selectionBox && (
        <div
          className="absolute border border-blue-500 border-dashed bg-blue-100 bg-opacity-30 pointer-events-none"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: Math.max(0, selectionBox.right - selectionBox.left),
            height: Math.max(0, selectionBox.bottom - selectionBox.top),
          }}
        />
      )}
    </div>
  );
};
