/**
 * Browser-side download helper for DOCX results.
 *
 * The processors already return a Blob with the correct MIME type, so nothing is re-encoded here.
 * The object URL is revoked shortly after the click; revoking immediately can cancel the download
 * in some browsers.
 */

export const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
  }
}
