import { 
  PdfPageObject, 
  PdfTextObject, 
  PdfImageObject 
} from "../pdf/editor/types";
import { 
  LayahSourceObject, 
  LayahTextObject, 
  LayahImageObject, 
  LayahUnknownObject 
} from "./types";

/**
 * Maps PdfEditorEngine objects to Layah Source Model objects.
 * Responsible for generating stable IDs and converting bounds/transforms.
 */
export class PdfToLayahMapper {
  // We use a counter per page and per object type to guarantee deterministic,
  // stable IDs if the same source PDF is parsed multiple times.
  private typeCounters = new Map<string, number>();

  resetCounters() {
    this.typeCounters.clear();
  }

  /**
   * Maps a PdfEditorEngine object to a stable Layah source object.
   */
  mapObject(pdfObj: PdfPageObject): LayahSourceObject {
    const key = `page-${pdfObj.pageIndex}-${pdfObj.type}`;
    const count = (this.typeCounters.get(key) || 0) + 1;
    this.typeCounters.set(key, count);

    const stableId = `${key}-${count}`;

    // Normalize base properties
    const baseProps = {
      id: stableId,
      pageIndex: pdfObj.pageIndex,
      bounds: { ...pdfObj.bounds },
      transform: pdfObj.transform ? { ...pdfObj.transform } : null,
      provenance: {
        kind: "source" as const,
        // We do not store the transient pdfObj.id (which is a WASM pointer)
        // to prevent leaking the engine implementation into the model.
      }
    };

    if (pdfObj.type === "text") {
      const textObj = pdfObj as PdfTextObject;
      return {
        ...baseProps,
        type: "text",
        text: textObj.text,
      } as LayahTextObject;
    }

    if (pdfObj.type === "image") {
      return {
        ...baseProps,
        type: "image",
      } as LayahImageObject;
    }

    // Acknowledge unknown objects safely without failing
    return {
      ...baseProps,
      type: "unknown",
      engineType: (pdfObj as any).type,
    } as LayahUnknownObject;
  }

  /**
   * Generates a stable ID for the page itself.
   */
  mapPageId(pageIndex: number): string {
    return `page-${pageIndex}`;
  }
}
