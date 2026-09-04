// Intelligence operations use dynamic imports for react-pdf to prevent SSR DOMMatrix crashes.

function buildFilename(originalName: string, suffix: string) {
  const sanitizedName = originalName.toLowerCase().endsWith(".pdf")
    ? originalName.slice(0, -4)
    : originalName;
  return `${sanitizedName}-${suffix}`;
}

/**
 * 1. PDF to Image (JPG/PNG)
 */
export async function pdfToImage(
  file: File,
  format: "jpeg" | "png",
  scale: number = 2.0,
  onProgress?: (msg: string) => void
) {
  onProgress?.("Initializing PDF.js engine...");
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const fileBytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument(new Uint8Array(fileBytes));
  const pdfDoc = await loadingTask.promise;

  const results = [];
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const extension = format === "jpeg" ? "jpg" : "png";

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    onProgress?.(`Rendering page ${i} of ${pdfDoc.numPages}...`);
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Fill white background for JPEG (since canvas is transparent by default)
    if (format === "jpeg") {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    await page.render({ canvasContext: ctx, viewport } as any).promise;

    // Convert canvas to blob (or array buffer)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, 0.95)
    );

    if (blob) {
      results.push({
        filename: buildFilename(file.name, `page-${i}.${extension}`),
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    }
  }

  return results;
}

/**
 * 2. Extract Text (with bounding boxes)
 */
export async function extractPdfText(
  file: File,
  onProgress?: (msg: string) => void
) {
  onProgress?.("Loading document for text extraction...");
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const fileBytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument(new Uint8Array(fileBytes));
  const pdfDoc = await loadingTask.promise;

  const documentData: any = {
    metadata: { pages: pdfDoc.numPages },
    pages: [],
  };

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    onProgress?.(`Extracting text from page ${i}...`);
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    const pageTexts = content.items.map((item: any) => {
      // transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
      const tx = item.transform;
      return {
        text: item.str,
        x: tx[4],
        y: tx[5],
        width: item.width,
        height: item.height,
        fontName: item.fontName,
      };
    });

    documentData.pages.push({
      pageNumber: i,
      width: viewport.width,
      height: viewport.height,
      items: pageTexts,
    });
  }

  const jsonString = JSON.stringify(documentData, null, 2);
  const bytes = new TextEncoder().encode(jsonString);

  return [
    {
      filename: buildFilename(file.name, "text.json"),
      bytes,
    },
  ];
}

/**
 * 3. Analyze Document Structure
 */
export async function analyzeDocumentStructure(
  file: File,
  onProgress?: (msg: string) => void
) {
  onProgress?.("Analyzing document structure...");
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const fileBytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument(new Uint8Array(fileBytes));
  const pdfDoc = await loadingTask.promise;

  const metadata = await pdfDoc.getMetadata();

  const structure: any = {
    info: metadata.info,
    pageCount: pdfDoc.numPages,
    outline: [],
  };

  // Extremely basic heuristic: group text by Y coordinates to form lines/blocks,
  // identify larger fonts as headings.
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    onProgress?.(`Analyzing layout of page ${i}...`);
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    
    let maxFontSize = 0;
    const items = content.items.map((item: any) => {
      const fontSize = item.transform[0]; // roughly scaleX
      if (fontSize > maxFontSize) maxFontSize = fontSize;
      return { str: item.str, y: Math.round(item.transform[5]), fontSize };
    });

    // Group items by Y coordinate (lines)
    const lines: Record<number, string[]> = {};
    items.forEach((item) => {
      if (!lines[item.y]) lines[item.y] = [];
      lines[item.y].push(item.str);
    });

    // Detect headings (font size > average)
    const headings = items
      .filter((item) => item.fontSize > 12 && item.str.trim().length > 0) // rough heuristic
      .map((item) => item.str);

    structure.outline.push({
      page: i,
      headings: Array.from(new Set(headings)),
      lineCount: Object.keys(lines).length,
    });
  }

  const bytes = new TextEncoder().encode(JSON.stringify(structure, null, 2));

  return [
    {
      filename: buildFilename(file.name, "structure.json"),
      bytes,
    },
  ];
}

/**
 * 4. Extract Tables (Heuristic approach)
 */
export async function extractTables(
  file: File,
  onProgress?: (msg: string) => void
) {
  onProgress?.("Detecting tabular data...");
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const fileBytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument(new Uint8Array(fileBytes));
  const pdfDoc = await loadingTask.promise;

  const tablesOutput: any[] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    onProgress?.(`Scanning page ${i} for tables...`);
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();

    // Group texts into rows by rounding Y coordinate
    const rowMap: Record<number, any[]> = {};
    for (const item of content.items as any[]) {
      if (!item.str.trim()) continue;
      // Round to nearest 3 pixels to group slight misalignments
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!rowMap[y]) rowMap[y] = [];
      rowMap[y].push({ text: item.str, x: item.transform[4] });
    }

    // A table heuristic: Multiple rows with more than 2 items (columns)
    const rows = Object.values(rowMap)
      .filter((row) => row.length > 2)
      .sort((a, b) => b[0].y - a[0].y); // Sort Y descending

    if (rows.length > 2) {
      // Sort items inside row by X coordinate
      const structuredTable = rows.map((row) =>
        row.sort((a, b) => a.x - b.x).map((cell) => cell.text)
      );

      tablesOutput.push({
        page: i,
        confidence: "heuristic-low", // Noting this is a basic heuristic
        data: structuredTable,
      });
    }
  }

  const bytes = new TextEncoder().encode(JSON.stringify(tablesOutput, null, 2));

  return [
    {
      filename: buildFilename(file.name, "tables.json"),
      bytes,
    },
  ];
}
