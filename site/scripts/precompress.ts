import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { gzipSync, brotliCompressSync, constants } from "zlib";

const dist = join(import.meta.dir, "..", "dist");
const compressible = new Set([".html", ".js", ".css", ".svg", ".json", ".txt", ".xml", ".webmanifest"]);
const minBytes = 1024;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let count = 0;
let saved = 0;
for (const path of walk(dist)) {
  if (!compressible.has(extname(path))) continue;
  const buf = readFileSync(path);
  if (buf.byteLength < minBytes) continue;
  const gz = gzipSync(buf, { level: 9 });
  const br = brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.byteLength,
    },
  });
  writeFileSync(`${path}.gz`, gz);
  writeFileSync(`${path}.br`, br);
  saved += buf.byteLength - br.byteLength;
  count++;
}

console.log(`Precompressed ${count} assets (.gz + .br), saved ${(saved / 1024).toFixed(1)} KB over the wire with Brotli`);
