import { PDFDocument, rgb } from "pdf-lib";
import Tesseract from "tesseract.js";

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

export async function ocrPdf(
  file: File,
  onProgress?: (msg: string) => void
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
    
    // 1. Load with pdf-lib to modify the final output
    const pdfDoc = await PDFDocument.load(fileBytes);
    const pdfPages = pdfDoc.getPages();

    // 2. Load with PDF.js to render to canvas for Tesseract
    onProgress?.("Parsing document rendering engine...");
    const { pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    
    const loadingTask = pdfjs.getDocument(new Uint8Array(fileBytes));
    const pdfjsDoc = await loadingTask.promise;
    
    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      onProgress?.(`Rendering page ${i} of ${pdfjsDoc.numPages} for OCR...`);
      
      try {
        const page = await pdfjsDoc.getPage(i);
        // Use higher scale for better OCR accuracy (2.0 = ~144 DPI)
        const viewport = page.getViewport({ scale: 2.0 });
        
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({ canvasContext: ctx, viewport } as any).promise;
        
        const dataUrl = canvas.toDataURL("image/png");
        
        onProgress?.(`Running OCR on page ${i}...`);
        const { data } = await worker.recognize(dataUrl);
        
        // Map recognized words back to the pdf-lib document
        const targetPage = pdfPages[i - 1];
        const { height: pdfHeight, width: pdfWidth } = targetPage.getSize();
        
        // We must map Tesseract coordinates (which are scaled x2 on our canvas) back to PDF points
        const scaleX = pdfWidth / canvas.width;
        const scaleY = pdfHeight / canvas.height;
        
        const ocrData: any = data;
        if (ocrData.words) {
          for (const word of ocrData.words) {
            if (!word.text || !word.text.trim()) continue;
            
            const bbox = word.bbox;
            // x0, y0 is top-left in image.
            // PDF origin is bottom-left.
            const x = bbox.x0 * scaleX;
            const y = pdfHeight - (bbox.y1 * scaleY); 
            const w = (bbox.x1 - bbox.x0) * scaleX;
            const h = (bbox.y1 - bbox.y0) * scaleY;
            
            // Draw invisible text over the area to make it searchable
            targetPage.drawText(word.text, {
              x,
              y,
              size: h * 0.9,
              color: rgb(0, 0, 0),
              opacity: 0, // Invisible!
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to OCR page ${i}:`, err);
        // Continue to the next page instead of failing the entire document
      }
    }
    
    onProgress?.("Finalizing searchable document...");
    const finalBytes = await pdfDoc.save();
    
    return [
      {
        filename: buildFilename(file.name, "ocr"),
        bytes: finalBytes,
      }
    ];

  } finally {
    await worker.terminate();
  }
}
