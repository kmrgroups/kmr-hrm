import "server-only";
// Text out of a resume file, on the server, free: PDF (unpdf), Word .docx (the XML inside the file), plain text.
// Scanned resumes (a photo or an image-only PDF) have no text inside: they are marked "scanned" so HR can type the details.
import { unzipSync, strFromU8 } from "fflate";

export type ParseStatus = "parsed" | "scanned" | "failed";
export const RESUME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;   // Vercel accepts up to 4.5 MB per request

export const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

export function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name) });
  const order = Object.keys(files).sort((a, b) => (a.includes("document") ? -1 : b.includes("document") ? 1 : a.localeCompare(b)));
  return order.map((k) => decode(strFromU8(files[k])
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, "\t").replace(/<[^>]+>/g, ""))).join("\n");
}

/** old .doc (binary): keep the readable runs of text — enough for e-mail, phone and most words */
function docText(bytes: Uint8Array): string {
  let out = "", run = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if ((c >= 32 && c < 127) || c === 10 || c === 13 || c === 9) run += String.fromCharCode(c);
    else { if (run.length >= 4) out += run + "\n"; run = ""; }
  }
  return out;
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n");
}

export async function resumeText(bytes: Uint8Array, fileName: string): Promise<{ text: string; status: ParseStatus }> {
  const ext = extOf(fileName);
  try {
    let text = "";
    if (ext === "pdf") text = await pdfText(bytes);
    else if (ext === "docx") text = docxText(bytes);
    else if (ext === "doc") text = docText(bytes);
    else if (ext === "txt") text = new TextDecoder().decode(bytes);
    else if (["png", "jpg", "jpeg"].includes(ext)) return { text: "", status: "scanned" };
    else return { text: "", status: "failed" };
    text = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    // an image-only PDF gives (almost) no text
    if (text.replace(/\s/g, "").length < 60) return { text, status: ext === "pdf" ? "scanned" : "failed" };
    return { text: text.slice(0, 60000), status: "parsed" };
  } catch {
    return { text: "", status: "failed" };
  }
}
