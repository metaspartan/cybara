import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describePdfExtraction, extractPdfText, isPdfBytes } from "../../src/core/pdf-text";
import { handlePdf } from "../../src/core/skills/pdf";
import { handleRead } from "../../src/core/tools/handlers/file";
import { tinyPdf } from "../helpers/pdf-fixture";

const manual = tinyPdf(
  [
    ["MIL-STD-1913 Accessory Rail", "Slot width 0.206 inch"],
    ["Slot spacing 0.394 inch", "Rail top width 0.835 inch"],
  ],
  { title: "Rail Specification", author: "Unknown" }
);

describe("pdf text extraction", () => {
  test("extracts page text and metadata from a real PDF structure", async () => {
    expect(isPdfBytes(manual)).toBe(true);
    const extraction = await extractPdfText(manual);
    expect(extraction.pages).toBe(2);
    expect(extraction.extractedPages).toBe(2);
    expect(extraction.title).toBe("Rail Specification");
    expect(extraction.author).toBeUndefined();
    const credited = await extractPdfText(
      tinyPdf([["x"]], { title: "zrf2245.PDF", author: "J. Smith" })
    );
    expect(credited.title).toBeUndefined();
    expect(credited.author).toBe("J. Smith");
    expect(describePdfExtraction(credited)).toBe("by J. Smith (PDF, 1 page)");
    expect(extraction.text).toContain("[Page 1]");
    expect(extraction.text).toContain("Slot width 0.206 inch");
    expect(extraction.text).toContain("[Page 2]");
    expect(extraction.text).toContain("Rail top width 0.835 inch");
    expect(describePdfExtraction(extraction)).toBe("Rail Specification (PDF, 2 pages)");
  });

  test("caps the number of pages and reports the scope", async () => {
    const extraction = await extractPdfText(manual, { maxPages: 1 });
    expect(extraction.extractedPages).toBe(1);
    expect(extraction.text).not.toContain("Rail top width");
    expect(describePdfExtraction(extraction)).toContain("first 1 of 2 pages");
  });

  test("rejects non-PDF data and reports empty text for image-only documents", async () => {
    await expect(extractPdfText(Buffer.from("<html>not a pdf</html>"))).rejects.toThrow(
      "not a PDF"
    );
    const blank = await extractPdfText(tinyPdf([[]]));
    expect(blank.pages).toBe(1);
    expect(blank.text.trim()).toBe("");
  });

  test("the read tool returns extracted text for local PDFs with offset and limit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-pdf-read-"));
    const path = join(directory, "spec.pdf");
    writeFileSync(path, manual);
    try {
      const whole = await handleRead({ path });
      expect(whole.content).toContain("Rail Specification (PDF, 2 pages)");
      expect(whole.content).toContain("Slot spacing 0.394 inch");
      const window = await handleRead({ path, offset: 3, limit: 2 });
      expect(window.content).toContain("[Page 1]");
      expect(window.content).toContain("MIL-STD-1913 Accessory Rail");
      expect(window.content).not.toContain("Slot spacing");
      expect(window.content).toContain("Continue with offset 5");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the pdf skill uses embedded extraction when system tools are disabled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-pdf-skill-"));
    const path = join(directory, "spec.pdf");
    writeFileSync(path, manual);
    const savedFlag = process.env.CYBARA_PDF_EMBEDDED_ONLY;
    process.env.CYBARA_PDF_EMBEDDED_ONLY = "1";
    try {
      const result = (await handlePdf({ action: "extract_text", path })) as {
        text: string;
        pages: number;
        method: string;
      };
      expect(result.method).toBe("embedded");
      expect(result.pages).toBe(2);
      expect(result.text).toContain("Slot width 0.206 inch");
    } finally {
      if (savedFlag === undefined) delete process.env.CYBARA_PDF_EMBEDDED_ONLY;
      else process.env.CYBARA_PDF_EMBEDDED_ONLY = savedFlag;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
