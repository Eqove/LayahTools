export type MutationIntentType = "move" | "delete";

export interface MoveMutationIntent {
  type: "move";
  objectIds: string[];
  deltaX: number;
  deltaY: number;
}

export interface DeleteMutationIntent {
  type: "delete";
  objectIds: string[];
}

export type EditorMutationIntent = MoveMutationIntent | DeleteMutationIntent;

/**
 * A foundation for Editor Transactions to enable Undo/Redo.
 * Represents a discrete boundary between interaction and actual document mutation.
 */
export interface EditorTransaction {
  id: string;
  timestamp: number;
  intent: EditorMutationIntent;
  // In a full implementation, `before` and `after` would hold serialized document states or diffs
  // beforeSnapshot?: LayahDocumentState;
  // afterSnapshot?: LayahDocumentState;
}

/**
 * Simple factory to generate intents from interactions.
 */
export function createMoveIntent(objectIds: string[], deltaX: number, deltaY: number): MoveMutationIntent {
  return { type: "move", objectIds, deltaX, deltaY };
}

export function createDeleteIntent(objectIds: string[]): DeleteMutationIntent {
  return { type: "delete", objectIds };
}
