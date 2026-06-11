// PDF text extraction in the browser via pdf.js. Text-layer PDFs (most e-statements)
// extract cleanly here and never leave the device. CAS statements arrive password-
// protected — pdf.js decrypts locally given the password, which is never stored and never
// leaves the machine either. Scanned PDFs have no text layer — the caller falls back to
// sending a screenshot to Claude vision.

import * as pdfjs from "pdfjs-dist";
// Vite bundles the worker and gives us a URL to point pdf.js at.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// The document wants a password (or got a wrong one) — surfaced so the UI can prompt
// and retry locally.
export class PdfPasswordRequired extends Error {
  constructor(public readonly wrongPassword: boolean) {
    super(wrongPassword ? "Wrong PDF password." : "This PDF is password-protected.");
    this.name = "PdfPasswordRequired";
    Object.setPrototypeOf(this, PdfPasswordRequired.prototype);
  }
}

async function loadDoc(data: ArrayBuffer, password?: string) {
  try {
    return await pdfjs.getDocument({ data, password }).promise;
  } catch (e) {
    // pdf.js code 1 = password needed, 2 = incorrect password.
    if ((e as { name?: string })?.name === "PasswordException") {
      throw new PdfPasswordRequired((e as { code?: number }).code === 2);
    }
    throw e;
  }
}

// Extract VISUAL LINES (not a word soup): pdf.js gives positioned text runs; we bucket
// them by their y coordinate per page, then read each bucket left-to-right. Statement
// parsers (CAS) depend on line structure surviving extraction.
export async function pdfToLines(data: ArrayBuffer, password?: string): Promise<string[]> {
  const doc = await loadDoc(data, password);
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const runs: { text: string; x: number; y: number }[] = [];
    for (const it of content.items) {
      if ("str" in it && it.str.trim()) runs.push({ text: it.str, x: it.transform[4], y: it.transform[5] });
    }
    // Group runs whose baselines sit within ~2.5 units — one visual line.
    runs.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur: { y: number; parts: { x: number; text: string }[] } | null = null;
    const flush = () => {
      if (!cur) return;
      cur.parts.sort((a, b) => a.x - b.x);
      lines.push(cur.parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim());
      cur = null;
    };
    for (const r of runs) {
      if (!cur || Math.abs(cur.y - r.y) > 2.5) {
        flush();
        cur = { y: r.y, parts: [{ x: r.x, text: r.text }] };
      } else {
        cur.parts.push({ x: r.x, text: r.text });
      }
    }
    flush();
  }
  return lines;
}

export async function pdfToText(data: ArrayBuffer, password?: string): Promise<string> {
  return (await pdfToLines(data, password)).join("\n").trim();
}
