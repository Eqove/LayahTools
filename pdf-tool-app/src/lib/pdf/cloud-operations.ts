// Cloud Abstractions
// This file serves as the interface boundary for capabilities that strictly require
// backend/cloud infrastructure (such as true PDF to Word/Excel conversion with formatting preservation).

export async function pdfToWordCloud(file: File, onProgress?: (msg: string) => void): Promise<any[]> {
  onProgress?.("Connecting to cloud processing engine...");
  // Simulate network delay for the interface demonstration
  await new Promise(resolve => setTimeout(resolve, 800));
  
  throw new Error("PDF to Word conversion requires a cloud backend (e.g. Adobe PDF Services). Backend integration pending Phase 3.");
}

export async function pdfToExcelCloud(file: File, onProgress?: (msg: string) => void): Promise<any[]> {
  onProgress?.("Connecting to cloud processing engine...");
  await new Promise(resolve => setTimeout(resolve, 800));
  
  throw new Error("PDF to Excel conversion requires a cloud backend (e.g. Adobe PDF Services). Backend integration pending Phase 3.");
}
