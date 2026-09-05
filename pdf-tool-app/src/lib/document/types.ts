/**
 * Core types for the Layah Document Model.
 * This model is completely independent of the PDFium engine, React, or any UI framework.
 */

// ---------------------------------------------------------
// 1. COORDINATES & BASIC TYPES
// ---------------------------------------------------------
// Uses canonical PDF coordinates: bottom-left origin, PDF points.
export interface LayahObjectBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface LayahTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export type LayahObjectId = string;
export type LayahObjectType = "text" | "image" | "path" | "unknown";

export interface LayahProvenance {
  kind: "source" | "created";
  sourceObjectId?: string;
}

// ---------------------------------------------------------
// 2. SOURCE MODEL (Authoritative physical representation)
// ---------------------------------------------------------
export interface LayahSourceBaseObject {
  id: LayahObjectId;
  type: LayahObjectType;
  pageIndex: number;
  bounds: LayahObjectBounds;
  transform: LayahTransform | null;
  provenance: LayahProvenance;
}

export interface LayahTextObject extends LayahSourceBaseObject {
  type: "text";
  text: string;
  fontFamily?: string;
  fontSize?: number;
}

export interface LayahImageObject extends LayahSourceBaseObject {
  type: "image";
}

export interface LayahPathObject extends LayahSourceBaseObject {
  type: "path";
}

export interface LayahUnknownObject extends LayahSourceBaseObject {
  type: "unknown";
  engineType?: string | number; // Safe metadata for unknown physical objects
}

export type LayahSourceObject =
  | LayahTextObject
  | LayahImageObject
  | LayahPathObject
  | LayahUnknownObject;

// ---------------------------------------------------------
// 3. LAYOUT / INTERPRETATION MODEL
// ---------------------------------------------------------
export interface LayahTextRun {
  id: string;
  sourceObjectId: LayahObjectId;
  text: string;
  bounds: LayahObjectBounds;
}

export interface LayahTextBlock {
  id: string;
  pageIndex: number;
  bounds: LayahObjectBounds;
  runs: string[]; // References to LayahTextRun IDs
  confidence?: number;
}

export interface LayahLayout {
  textBlocks: Record<string, LayahTextBlock>;
  runs: Record<string, LayahTextRun>;
}

// ---------------------------------------------------------
// 4. DOCUMENT STRUCTURE
// ---------------------------------------------------------
export interface LayahPage {
  id: string;
  pageIndex: number;
  width: number;
  height: number;
  objects: Record<string, LayahSourceObject>;
  layout: LayahLayout;
}

export interface LayahDocument {
  id: string;
  pages: Record<number, LayahPage>;
  metadata: Record<string, any>;
}

// ---------------------------------------------------------
// 5. EDITOR STATE (Interaction state)
// ---------------------------------------------------------
export interface LayahEditorState {
  activePageIndex: number;
  selectedObjectIds: string[];
  dirty: boolean;
}
