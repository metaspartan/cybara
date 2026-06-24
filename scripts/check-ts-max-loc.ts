import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

interface FileStat {
  path: string;
  lines: number;
}

function parseMaxArg(defaultMax: number): number {
  const maxIndex = process.argv.indexOf("--max");
  if (maxIndex < 0) return defaultMax;
  const raw = process.argv[maxIndex + 1];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultMax;
  return parsed;
}

function collectTsFiles(root: string, files: string[] = []): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!fullPath.endsWith(".ts") && !fullPath.endsWith(".tsx")) continue;
    files.push(fullPath);
  }
  return files;
}

function countLines(path: string): number {
  const contents = readFileSync(path, "utf8");
  if (contents.length === 0) return 0;
  return contents.split(/\r?\n/).length;
}

const maxLines = parseMaxArg(5500);
const roots = ["src", "ui/src", "tests"];
const existingRoots = roots.filter((root) => {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
});

// Legacy large modules that previously exceeded the LOC guard. Both have now
// been decomposed under the 5500-line limit (IDE.tsx split into ui/src/pages/ide/*,
// routes.ts split into src/api/routes/_shared.ts), so the exception list is empty.
// Kept as a mechanism so future intentional exceptions can be documented here.
const LOC_EXCEPTIONS: ReadonlySet<string> = new Set<string>([]);

const files = existingRoots.flatMap((root) => collectTsFiles(root));
const stats: FileStat[] = files.map((path) => ({ path, lines: countLines(path) }));
const offenders = stats
  .filter((stat) => stat.lines > maxLines)
  .filter((stat) => !LOC_EXCEPTIONS.has(stat.path))
  .sort((a, b) => b.lines - a.lines);
const largest = [...stats].sort((a, b) => b.lines - a.lines).slice(0, 10);

console.log(`Checked ${stats.length} TypeScript files (max ${maxLines} LOC per file).`);
console.log("Top 10 largest files:");
for (const item of largest) {
  const flagged = item.lines > maxLines && !LOC_EXCEPTIONS.has(item.path) ? "  <-- OVER" : "";
  const exempt = LOC_EXCEPTIONS.has(item.path) ? "  (exempt: legacy monolith)" : "";
  console.log(`  ${item.lines.toString().padStart(5)}  ${item.path}${flagged}${exempt}`);
}

if (offenders.length > 0) {
  console.error(`\nFound ${offenders.length} file(s) over max LOC:`);
  for (const offender of offenders) {
    console.error(`  ${offender.lines.toString().padStart(5)}  ${offender.path}`);
  }
  process.exit(1);
}

console.log("\nLOC gate passed.");

