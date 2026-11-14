import { PDFDocument } from "pdf-lib";
import Tesseract from "tesseract.js";
import { overlayOcrText, type OcrOverlayOptions, type OcrRecognizer, type OcrWord } from "./ocr-overlay";

function buildFilename(originalName: string, suffix: string) {
  const sanitizedName = originalName.toLowerCase().endsWith(".pdf")
    ? originalName.slice(0, -4)
    : originalName;
  return `${sanitizedName}-${suffix}.pdf`;
}

export async function compressPdf(
  file: File,
  level: "low" | "recommended" | "strong",
  onProgress?: (msg: string) => void
) {
  onProgress?.("Parsing structural tree...");

  // Note: V1 compression is structural only using pdf-lib.
  // True image downsampling requires a backend or heavy WASM layer (Ghostscript/MuPDF).
  // This structural rebuild strips some garbage objects and redundant metadata.

  const bytes = await file.arrayBuffer();
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });

  onProgress?.("Rebuilding PDF structures...");

  // Creating a new document and copying pages can drop orphaned objects
  const target = await PDFDocument.create();
  const copiedPages = await target.copyPages(source, source.getPageIndices());
  copiedPages.forEach((page) => target.addPage(page));

  // Set standard metadata
  target.setCreator("LayahTools V1");
  target.setProducer("LayahTools V1");

  onProgress?.("Compressing streams...");

  // pdf-lib's save automatically applies deflate compression to content streams
  const compressedBytes = await target.save({ useObjectStreams: true });

  return [
    {
      filename: buildFilename(file.name, "compressed"),
      bytes: compressedBytes,
    },
  ];
}

export interface OcrPdfOptions {
  /** 0-based pages to OCR. Default: every page. */
  pages?: number[];
  /** Called as each page starts, finishes or fails (see ocr-overlay.ts). */
  onPageStatus?: OcrOverlayOptions["onPageStatus"];
}

/**
 * Browser OCR: renders pages with PDF.js, recognises them with Tesseract and writes the words back as an invisible
 * text layer (overlayOcrText). Returns a NEW PDF; the input file is never modified. Throws OcrError if the document
 * cannot be processed or every selected page fails.
 */
export async function ocrPdf(
  file: File,
  onProgress?: (msg: string) => void,
  options: OcrPdfOptions = {}
) {
  onProgress?.("Initializing OCR worker...");

  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress?.(`Recognizing text: ${Math.round(m.progress * 100)}%`);
      }
    }
  });

  try {
    const fileBytes = await file.arrayBuffer();

    onProgress?.("Parsing document rendering engine...");
    const { pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

    // PDF.js transfers the buffer it is given, so it gets its own copy and pdf-lib keeps the original bytes.
    const pdfjsDoc = await pdfjs.getDocument(new Uint8Array(fileBytes.slice(0))).promise;

    const recognize: OcrRecognizer = async (pageIndex) => {
      onProgress?.(`Rendering page ${pageIndex + 1} of ${pdfjsDoc.numPages} for OCR...`);
      const page = await pdfjsDoc.getPage(pageIndex + 1);
      // Higher scale for better OCR accuracy (2.0 = ~144 DPI)
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("the browser could not create a drawing surface for this page");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport } as any).promise;

      onProgress?.(`Running OCR on page ${pageIndex + 1}...`);
      const { data } = await worker.recognize(canvas.toDataURL("image/png"));
      const words = (data as unknown as { words?: OcrWord[] }).words ?? [];
      return { words, imageWidth: canvas.width, imageHeight: canvas.height };
    };

    const { bytes } = await overlayOcrText(fileBytes, recognize, {
      pages: options.pages,
      onPageStatus: options.onPageStatus,
    });

    onProgress?.("Finalizing searchable document...");
    return [
      {
        filename: buildFilename(file.name, "ocr"),
        bytes,
      }
    ];
  } finally {
    await worker.terminate();
  }
}
