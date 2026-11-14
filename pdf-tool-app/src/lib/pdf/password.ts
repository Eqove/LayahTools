import { PDFDocument } from "pdf-lib";

/**
 * Checks whether a PDF file is encrypted and requires a password to open.
 */
export async function isEncryptedPdf(file: File): Promise<boolean> {
  try {
    const bytes = await file.arrayBuffer();
    await PDFDocument.load(bytes);
    return false;
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("encrypt") || msg.includes("password");
  }
}

/**
 * Verifies the password cryptographically using PDF.js and returns a clean,
 * decrypted File object whose pages open without any password.
 * 
 * Security rule: password is never stored or logged.
 */
export async function unlockEncryptedPdf(file: File, password: string): Promise<File> {
  const bytes = await file.arrayBuffer();

  // 1. Verify password cryptographically using PDF.js
  let pdfjs: { getDocument: (params: Record<string, unknown>) => { promise: Promise<unknown> } };
  try {
    const reactPdf = await import("react-pdf");
    pdfjs = reactPdf.pdfjs;
  } catch {
    // Fallback for Node test runner
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  // Clone bytes so PDF.js worker transfer does not detach the original buffer
  const verificationBytes = new Uint8Array(bytes.slice(0));

  try {
    const loadingTask = pdfjs.getDocument({
      data: verificationBytes,
      password,
    });
    await loadingTask.promise;
  } catch (err: unknown) {
    const errObj = err as { name?: string; message?: string };
    if (errObj?.name === "PasswordException" || (errObj?.message || "").includes("Password")) {
      throw new Error("Incorrect password. Please try again.");
    }
    throw new Error(`Failed to unlock document: ${errObj?.message || "Unknown error"}`);
  }

  // 2. Load with pdf-lib ignoring encryption, and copy pages into a clean document
  const source = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  const clean = await PDFDocument.create();
  const copiedPages = await clean.copyPages(source, source.getPageIndices());
  copiedPages.forEach((page) => clean.addPage(page));

  const cleanBytes = await clean.save();
  return new File([cleanBytes as BlobPart], file.name, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}
