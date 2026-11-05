import React from 'react';
import { ViewportBounds } from "../../../lib/document/coordinates";

export interface SelectionOverlayProps {
  /** Bounds of currently selected objects, converted to Viewport pixels */
  selectedObjectBounds: Array<{ id: string; bounds: ViewportBounds }>;
  
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
}

/**
 * Foundation contract for the future React overlay.
 * Renders absolutely positioned bounding boxes over the PDF.js viewport.
 */
export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  selectedObjectBounds,
  groupSelectionBounds,
  hoverBounds,
  phase,
  selectionBox
}) => {
  return (
    <div className="absolute inset-0 pointer-events-none z-50">
      {/* 1. Hover State */}
      {hoverBounds && phase === "idle" && (
        <div 
          className="absolute border border-blue-300 bg-blue-100 bg-opacity-20 pointer-events-none"
          style={{
            left: hoverBounds.left,
            top: hoverBounds.top,
            width: hoverBounds.right - hoverBounds.left,
            height: hoverBounds.bottom - hoverBounds.top
          }}
        />
      )}

      {/* 2. Individual Selection Highlights */}
      {selectedObjectBounds.map(({ id, bounds }) => (
        <div
          key={id}
          className="absolute border border-blue-500 bg-blue-200 bg-opacity-30 pointer-events-none"
          style={{
            left: bounds.left,
            top: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top
          }}
        />
      ))}

      {/* 3. Group Selection Box (The main interactable boundary in the future) */}
      {groupSelectionBounds && selectedObjectBounds.length > 1 && (
        <div 
          className="absolute border-2 border-blue-600 pointer-events-none"
          style={{
            left: groupSelectionBounds.left,
            top: groupSelectionBounds.top,
            width: groupSelectionBounds.right - groupSelectionBounds.left,
            height: groupSelectionBounds.bottom - groupSelectionBounds.top
          }}
        />
      )}

      {/* 4. Rubber-band Selection Marquee */}
      {phase === "selecting" && selectionBox && (
        <div 
          className="absolute border border-gray-400 bg-blue-100 bg-opacity-40 pointer-events-none"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.right - selectionBox.left,
            height: selectionBox.bottom - selectionBox.top
          }}
        />
      )}
    </div>
  );
};
