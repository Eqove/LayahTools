export type PdfToolId =
  | "merge"
  | "split"
  | "extract"
  | "delete"
  | "rotate"
  | "watermark"
  | "page-numbers"
  | "blank";

export type ToolDescriptor = {
  id: PdfToolId;
  name: string;
  summary: string;
  acceptsMultiple: boolean;
  primaryLabel: string;
};
