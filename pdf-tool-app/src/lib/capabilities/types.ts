export type CapabilityCategory = "organize" | "understand" | "convert" | "secure" | "create";

export interface Capability {
  id: string;
  name: string;
  category: CapabilityCategory;
  supportedInputTypes: string[];
  supportedOutputTypes: string[];
  configurationSchema?: Record<string, any>;
  processingEngine?: string;
  clientServerSuitability?: "client-only" | "server-only" | "isomorphic";
  workerRequirement?: "none" | "optional" | "required";
  isDestructive: boolean;
  supportsPreview: boolean;
  aiActionSchema?: Record<string, any>;
  
  // Legacy fields for existing UI compatibility
  summary: string;
  supportsBatch: boolean;
}
