// Routes a dropped file to the right parser. CSV/XLSX are structured and parse locally
// with no AI. PDF text is extracted locally, then sent to Claude only to structure it.
// Images (screenshots / scanned pages) go to Claude vision. The caller surfaces a
// "this document will be sent to Claude" confirmation before any AI step runs.

import type { ImportDraft } from "../domain/types";
import { parseCsv } from "./csv";
import { parseXlsx } from "./xlsx";
import { pdfToText } from "./pdf";
import { extractFromImage, extractFromText } from "./aiExtract";

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

  if (ext === "csv") return parseCsv(await fileText(file), file.name);
  if (ext === "xlsx" || ext === "xls") return [...parseXlsx(await fileBuf(file), file.name)];

  if (ext === "pdf") {
    const text = await pdfToText(await fileBuf(file));
    if (text.length < 80) {
      throw new Error(
        "This PDF has no selectable text (it's likely scanned). Take a screenshot of the " +
          "page(s) and import the image instead.",
      );
    }
    return [await extractFromText(text, file.name)];
  }

  if (ext in IMG_MIME) {
    return [await extractFromImage(IMG_MIME[ext], await fileBase64(file), file.name)];
  }

  // Unknown extension: try CSV as a last resort.
  return parseCsv(await fileText(file), file.name);
}
