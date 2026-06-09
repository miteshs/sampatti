// PDF text extraction in the browser via pdf.js. Text-layer PDFs (most e-statements)
// extract cleanly here and never leave the device; only the extracted text is later sent
// to Claude for structuring (and only if the user proceeds). Scanned PDFs have no text
// layer — the caller falls back to sending a screenshot to Claude vision.

import * as pdfjs from "pdfjs-dist";
// Vite bundles the worker and gives us a URL to point pdf.js at.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfToText(data: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages.join("\n").trim();
}
