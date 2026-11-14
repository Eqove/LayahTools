import { PDFDocument } from "pdf-lib";

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  producer?: string;
  creator?: string;
  creationDate?: string;
  modificationDate?: string;
  pageCount: number;
  fileSizeBytes: number;
  fileName: string;
}

/**
 * Extracts document metadata and properties from a PDF file using pdf-lib.
 */
export async function readPdfMetadata(file: File): Promise<PdfMetadata> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const formatDate = (d?: Date) => {
    if (!d) return undefined;
    try {
      return d.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return d.toISOString();
    }
  };

  const keywordsRaw = doc.getKeywords();
  const keywords = keywordsRaw
    ? keywordsRaw
        .split(/[,;]/)
        .map((k) => k.trim())
        .filter(Boolean)
    : undefined;

  return {
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    subject: doc.getSubject() || undefined,
    keywords: keywords && keywords.length > 0 ? keywords : undefined,
    producer: doc.getProducer() || undefined,
    creator: doc.getCreator() || undefined,
    creationDate: formatDate(doc.getCreationDate()),
    modificationDate: formatDate(doc.getModificationDate()),
    pageCount: doc.getPageCount(),
    fileSizeBytes: file.size,
    fileName: file.name,
  };
}

