export type PdfToolId =
  | "merge"
  | "split"
  | "extract"
  | "delete"
  | "rotate"
  | "watermark"
  | "page-numbers"
  | "blank"
  | "rearrange"
  | "redact"
  | "sign"
  | "compress"
  | "ocr"
  | "pdf-to-image"
  | "extract-text"
  | "analyze-structure"
  | "extract-tables"
  | "crop"
  | "metadata"
  | "fill-form"
  | "flatten"
  | "edit";

export type ToolDescriptor = {
  id: PdfToolId;
  name: string;
  summary: string;
  acceptsMultiple: boolean;
  primaryLabel: string;
};
