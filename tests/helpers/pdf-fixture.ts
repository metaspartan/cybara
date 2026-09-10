function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function tinyPdf(
  pages: string[][],
  options: { title?: string; author?: string } = {}
): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const lines of pages) {
    const content = [
      "BT",
      "/F1 14 Tf",
      "72 720 Td",
      "16 TL",
      ...lines.map((line, index) => `${index === 0 ? "" : "T* "}(${pdfEscape(line)}) Tj`),
      "ET",
    ].join("\n");
    const contentId = objects.length + 1;
    objects.push(
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`
    );
    const pageId = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let infoRef = "";
  if (options.title || options.author) {
    const entries = [
      options.title ? `/Title (${pdfEscape(options.title)})` : "",
      options.author ? `/Author (${pdfEscape(options.author)})` : "",
    ].filter(Boolean);
    objects.push(`<< ${entries.join(" ")} >>`);
    infoRef = ` /Info ${objects.length} 0 R`;
  }
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoRef} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
