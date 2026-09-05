import { LayahDocument, LayahEditorState, LayahPage, LayahSourceObject, LayahLayout } from "./types";

/**
 * Framework-independent document store.
 * Holds the Layah document model and the editor state.
 * Fully serializable.
 */
export class LayahDocumentStore {
  private document: LayahDocument;
  private editorState: LayahEditorState;

  constructor(initialDocument?: LayahDocument, initialEditorState?: LayahEditorState) {
    this.document = initialDocument || {
      id: `doc-${Date.now()}`,
      pages: {},
      metadata: {},
    };

    this.editorState = initialEditorState || {
      activePageIndex: 0,
      selectedObjectIds: [],
      dirty: false,
    };
  }

  // --- Document Access ---
  
  getDocument(): LayahDocument {
    return this.document;
  }

  getPage(pageIndex: number): LayahPage | undefined {
    return this.document.pages[pageIndex];
  }

  getObject(pageIndex: number, objectId: string): LayahSourceObject | undefined {
    const page = this.getPage(pageIndex);
    return page?.objects[objectId];
  }

  getLayout(pageIndex: number): LayahLayout | undefined {
    const page = this.getPage(pageIndex);
    return page?.layout;
  }

  // --- Document Mutation ---
  
  addPage(page: LayahPage): void {
    this.document.pages[page.pageIndex] = page;
    this.markDirty();
  }

  addObject(pageIndex: number, object: LayahSourceObject): void {
    const page = this.getPage(pageIndex);
    if (!page) throw new Error(`Page ${pageIndex} does not exist`);
    page.objects[object.id] = object;
    this.markDirty();
  }

  // --- Editor State ---
  
  getEditorState(): LayahEditorState {
    return this.editorState;
  }

  setActivePage(pageIndex: number): void {
    this.editorState.activePageIndex = pageIndex;
  }

  selectObjects(objectIds: string[]): void {
    this.editorState.selectedObjectIds = [...objectIds];
  }

  markDirty(): void {
    this.editorState.dirty = true;
  }

  clearDirty(): void {
    this.editorState.dirty = false;
  }

  // --- Serialization ---
  
  /**
   * Serializes the document and editor state to a plain JSON string.
   * Guarantees no WASM/DOM instances leak into the output.
   */
  serialize(): string {
    return JSON.stringify({
      document: this.document,
      editorState: this.editorState,
    });
  }

  /**
   * Restores the store from a serialized JSON string.
   */
  static deserialize(json: string): LayahDocumentStore {
    const parsed = JSON.parse(json);
    if (!parsed.document) {
      throw new Error("Invalid serialized data: missing document");
    }
    return new LayahDocumentStore(parsed.document, parsed.editorState);
  }
}
