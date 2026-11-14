import * as path from "path";
import { pathToFileURL } from "url";

/** Test-only: loads a pdfjs-dist legacy build in Node. `root` is a pdfjs-dist package folder. */
export async function loadPdfJsNode(root = "node_modules/pdfjs-dist") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import(pathToFileURL(path.resolve(root, "legacy/build/pdf.mjs")).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve(root, "legacy/build/pdf.worker.mjs")).href;
  return pdfjs;
}
