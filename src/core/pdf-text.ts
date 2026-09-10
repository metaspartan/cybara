import { extractText, getDocumentProxy, getMeta } from "unpdf";

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 400;

export interface PdfTextExtraction {
  text: string;
  pages: number;
  extractedPages: number;
  title?: string;
  author?: string;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

function cleanPageText(page: string): string {
  return page
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\f]+/g, " ").trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join("\n")
    .trim();
}

function metaString(info: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = info?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && !/^(untitled|unknown|none|n\/a|anonymous|\w+\.tmp|\w+\.pdf)$/i.test(trimmed)
    ? trimmed
    : undefined;
}

export async function extractPdfText(
  input: Uint8Array | ArrayBuffer,
  options: { maxPages?: number } = {}
): Promise<PdfTextExtraction> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_PDF_BYTES) {
    throw new Error(`PDF is larger than the ${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB limit`);
  }
  if (!isPdfBytes(bytes)) {
    throw new Error("The data is not a PDF document");
  }
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) throw new Error("PDF is password protected");
    throw new Error(`PDF could not be parsed: ${message}`);
  }
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? DEFAULT_MAX_PAGES));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = text.slice(0, maxPages).map(cleanPageText);
  const body = pages
    .map((page, index) => (pages.length > 1 && page ? `[Page ${index + 1}]\n${page}` : page))
    .filter(Boolean)
    .join("\n\n");
  let info: Record<string, unknown> | undefined;
  try {
    info = (await getMeta(pdf)).info as Record<string, unknown> | undefined;
  } catch {
    info = undefined;
  }
  return {
    text: body,
    pages: totalPages,
    extractedPages: Math.min(totalPages, maxPages),
    title: metaString(info, "Title"),
    author: metaString(info, "Author"),
  };
}

export function describePdfExtraction(extraction: PdfTextExtraction): string {
  const scope =
    extraction.extractedPages < extraction.pages
      ? `first ${extraction.extractedPages} of ${extraction.pages} pages`
      : `${extraction.pages} page${extraction.pages === 1 ? "" : "s"}`;
  const heading = [extraction.title, extraction.author && `by ${extraction.author}`]
    .filter(Boolean)
    .join(" ");
  return `${heading ? `${heading} ` : ""}(PDF, ${scope})`;
}

export const SCANNED_PDF_NOTICE =
  "The PDF contains no extractable text; it is probably scanned images. Use OCR on the pages or configure a Firecrawl or Parallel key for OCR-backed extraction.";
