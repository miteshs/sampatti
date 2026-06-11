// Routes a dropped file to the right parser. CSV/XLSX are structured and parse locally
// with no AI. PDFs are extracted locally first — a CAMS/KFintech CAS is then parsed FULLY
// locally (password and all; it never touches the AI path); other PDFs' text is sent to
// Claude only to structure it. Images (screenshots / scanned pages) go to Claude vision.
// The caller surfaces a "this document will be sent to Claude" confirmation before any AI
// step runs.

import type { ImportDraft } from "../domain/types";
import { parseCsv } from "./csv";
import { parseXlsx, xlsxToCsv } from "./xlsx";
import { extractFromImage, extractFromText } from "./aiExtract";
import { looksLikeCas, parseCamsCas } from "./cas";

// pdf.js (~the largest dependency) is loaded lazily on first PDF import so it stays out of
// the initial bundle — most sessions never open a PDF.
const loadPdf = () => import("./pdf");

// Thrown when a CSV/Excel file can't be parsed locally with confidence (unrecognized
// columns or a parse error). Carries the file so the UI can offer to re-parse with Claude.
export class NeedsClaudeError extends Error {
  constructor(public readonly file: File, message: string) {
    super(message);
    this.name = "NeedsClaudeError";
    // Keep `instanceof` working even if the class is down-leveled in the bundle.
    Object.setPrototypeOf(this, NeedsClaudeError.prototype);
  }
}

// Thrown for password-protected PDFs so the UI can prompt and retry — decryption happens
// on this device via pdf.js; the password is never stored and never leaves the machine.
export class PdfPasswordError extends Error {
  constructor(public readonly file: File, public readonly wrongPassword: boolean) {
    super(wrongPassword ? "That password didn't open the file." : "This PDF is password-protected.");
    this.name = "PdfPasswordError";
    Object.setPrototypeOf(this, PdfPasswordError.prototype);
  }
}

const countHoldings = (drafts: ImportDraft[]) => drafts.reduce((n, d) => n + d.holdings.length, 0);

const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

export type IngestKind = "local" | "ai-text" | "ai-image";

// Inspect a file and report how it will be handled (so the UI can warn before sending).
export function classifyFile(file: File): IngestKind {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") return "local";
  if (ext === "xlsx" || ext === "xls") return "local";
  if (ext === "pdf") return "ai-text"; // may be sent to Claude to structure
  if (ext in IMG_MIME) return "ai-image";
  return "local";
}

// Extensions we know how to import. Used to filter a multi-file / folder selection so
// unrelated files — and hidden/system files like .DS_Store — are skipped rather than fed
// to the CSV last-resort parser.
export const IMPORTABLE_EXTS = ["csv", "xlsx", "xls", "pdf", "png", "jpg", "jpeg", "webp", "gif"] as const;
const IMPORTABLE = new Set<string>(IMPORTABLE_EXTS);

export function isImportable(file: File): boolean {
  if (!file.name || file.name.startsWith(".")) return false; // skip hidden / system files
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMPORTABLE.has(ext);
}

const fileText = (f: File) => f.text();
const fileBuf = (f: File) => f.arrayBuffer();

async function fileBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

export async function ingestFile(file: File): Promise<ImportDraft[]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "csv") {
    const text = await fileText(file);
    let drafts: ImportDraft[] = [];
    try { drafts = parseCsv(text, file.name); } catch { /* unreadable — offer Claude below */ }
    if (countHoldings(drafts) === 0) throw new NeedsClaudeError(file, "Couldn't recognize this CSV's columns automatically.");
    return drafts;
  }
  if (ext === "xlsx" || ext === "xls") {
    const buf = await fileBuf(file);
    let drafts: ImportDraft[] = [];
    try { drafts = [...parseXlsx(buf, file.name)]; } catch { /* unreadable — offer Claude below */ }
    if (countHoldings(drafts) === 0) throw new NeedsClaudeError(file, "Couldn't recognize this spreadsheet's columns automatically.");
    return drafts;
  }

  if (ext === "pdf") {
    return ingestPdf(file);
  }

  if (ext in IMG_MIME) {
    return extractFromImage(IMG_MIME[ext], await fileBase64(file), file.name);
  }

  // Unknown extension: try CSV as a last resort.
  return parseCsv(await fileText(file), file.name);
}

// PDFs: extract lines locally (decrypting locally when a password is supplied). A CAS is
// parsed fully on-device; anything else goes to the Claude text path the caller confirmed.
export async function ingestPdf(file: File, password?: string): Promise<ImportDraft[]> {
  const { pdfToLines, PdfPasswordRequired } = await loadPdf();
  let lines: string[];
  try {
    lines = await pdfToLines(await fileBuf(file), password);
  } catch (e) {
    if (e instanceof PdfPasswordRequired) throw new PdfPasswordError(file, e.wrongPassword);
    throw e;
  }
  if (looksLikeCas(lines)) {
    return parseCamsCas(lines, file.name);
  }
  const text = lines.join("\n").trim();
  if (text.length < 80) {
    throw new Error(
      "This PDF has no selectable text (it's likely scanned). Take a screenshot of the " +
        "page(s) and import the image instead.",
    );
  }
  return extractFromText(text, file.name);
}

// The opt-in fallback: send a file to Claude to extract holdings. Used when local CSV/Excel
// parsing came up empty, or for PDFs/images. The user always triggers this explicitly.
export async function ingestWithClaude(file: File): Promise<ImportDraft[]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext in IMG_MIME) {
    return extractFromImage(IMG_MIME[ext], await fileBase64(file), file.name);
  }
  let text: string;
  if (ext === "pdf") {
    const { pdfToText } = await loadPdf();
    text = await pdfToText(await fileBuf(file));
  } else if (ext === "xlsx" || ext === "xls") {
    text = xlsxToCsv(await fileBuf(file));
  } else {
    text = await fileText(file);
  }
  if (!text.trim()) throw new Error("This file appears to be empty.");
  return extractFromText(text, file.name);
}
