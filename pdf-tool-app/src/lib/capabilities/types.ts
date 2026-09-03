export type CapabilityCategory = "organize" | "understand" | "convert" | "secure" | "create";

export interface Capability {
  id: string; // e.g., "pdf.merge"
  name: string;
  category: CapabilityCategory;
  inputFormats: string[]; // e.g., ["pdf"], empty array implies no input required (like blank pdf)
  outputFormats: string[]; // e.g., ["pdf", "docx"]
  processingMode: "client" | "server" | "worker";
  destructive: boolean;
  supportsPreview: boolean;
  supportsBatch: boolean;
  supportsAI: boolean;
  
  // Legacy UI fields preserved to avoid breaking PdfStudio temporarily
  summary: string;
  acceptsMultiple: boolean;
  primaryLabel: string;
}
