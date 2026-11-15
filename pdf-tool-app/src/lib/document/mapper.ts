import { 
  PdfPageObject, 
  PdfTextObject, 
  PdfImageObject,
  PdfShapeObject
} from "../pdf/editor/types";
import { 
  LayahSourceObject, 
  LayahTextObject, 
  LayahImageObject, 
  LayahShapeObject,
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
        fontSize: textObj.fontSize,
        fontWeight: textObj.fontWeight,
        isItalic: textObj.italicAngle ? textObj.italicAngle !== 0 : undefined,
      } as LayahTextObject;
    }

    if (pdfObj.type === "image") {
      return {
        ...baseProps,
        type: "image",
      } as LayahImageObject;
    }

    if (pdfObj.type === "shape") {
      const sh = (pdfObj as PdfShapeObject).shape;
      return {
        ...baseProps,
        type: "shape",
        shape: { kind: sh.kind, x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2, strokeWidth: sh.strokeWidth ?? 2, stroke: sh.stroke ?? [0, 0, 0], fill: sh.fill },
      } as LayahShapeObject;
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
