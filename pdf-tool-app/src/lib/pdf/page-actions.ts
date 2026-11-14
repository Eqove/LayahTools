import { PDFDocument, degrees } from "pdf-lib";

/**
 * Rotates a single page by the given angle (default 90 deg clockwise) in-place.
 * Returns a new File object containing the updated document bytes.
 */
export async function rotateSinglePage(
  file: File,
  pageIndex: number,
  angleDegrees: number = 90
): Promise<File> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();

  if (pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error(`Invalid page index ${pageIndex}. Document has ${pages.length} pages.`);
  }

  const page = pages[pageIndex];
  const currentRotation = page.getRotation().angle;
  const newRotation = (currentRotation + angleDegrees) % 360;
  page.setRotation(degrees(newRotation));

  const savedBytes = await doc.save();
  return new File([savedBytes as BlobPart], file.name, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}

/**
 * Deletes a single page from a PDF document.
 * Returns a new File object with the page removed.
 * Guard: Cannot delete the only remaining page of a document.
 */
export async function deleteSinglePage(
  file: File,
  pageIndex: number
): Promise<File> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const total = doc.getPageCount();

  if (total <= 1) {
    throw new Error("Cannot delete the only page in a document.");
  }

  if (pageIndex < 0 || pageIndex >= total) {
    throw new Error(`Invalid page index ${pageIndex}. Document has ${total} pages.`);
  }

  doc.removePage(pageIndex);

  const savedBytes = await doc.save();
  return new File([savedBytes as BlobPart], file.name, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}

/**
 * Extracts a single page from a document into a standalone 1-page PDF.
 * Returns a new File object.
 */
export async function extractSinglePage(
  file: File,
  pageIndex: number
): Promise<File> {
  const bytes = await file.arrayBuffer();
  const source = await PDFDocument.load(bytes);
  const total = source.getPageCount();

  if (pageIndex < 0 || pageIndex >= total) {
    throw new Error(`Invalid page index ${pageIndex}. Document has ${total} pages.`);
  }

  const target = await PDFDocument.create();
  const [copiedPage] = await target.copyPages(source, [pageIndex]);
  target.addPage(copiedPage);

  const savedBytes = await target.save();
  const baseName = file.name.replace(/\.pdf$/i, "");
  const newName = `${baseName}-page-${pageIndex + 1}.pdf`;

  return new File([savedBytes as BlobPart], newName, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}
