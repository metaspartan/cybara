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

const sourceGlob = new Bun.Glob("**/*.{css,java,kt,kts,py,rs,swift,ts,tsx}");
const skippedDirectories = new Set([".build", ".git", "build", "dist", "node_modules"]);

async function collectSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const path of sourceGlob.scan({ cwd: root, onlyFiles: true })) {
    if (path.split("/").some((segment) => skippedDirectories.has(segment))) continue;
    files.push(`${root}/${path}`);
  }
  return files;
}

async function countLines(path: string): Promise<number> {
  const contents = await Bun.file(path).text();
  if (contents.length === 0) return 0;
  return contents.split(/\r?\n/).length;
}

const maxLines = parseMaxArg(5000);
const roots = ["src", "ui/src", "tests", "apps", "shared", "scripts", "site/src"];
const LOC_EXCEPTIONS: ReadonlySet<string> = new Set<string>([]);

const files = (await Promise.all(roots.map(collectSourceFiles))).flat();
const stats: FileStat[] = await Promise.all(
  files.map(async (path): Promise<FileStat> => ({ path, lines: await countLines(path) }))
);
const offenders = stats
  .filter((stat) => stat.lines > maxLines)
  .filter((stat) => !LOC_EXCEPTIONS.has(stat.path))
  .sort((a, b) => b.lines - a.lines);
const largest = [...stats].sort((a, b) => b.lines - a.lines).slice(0, 10);

console.log(`Checked ${stats.length} source files (max ${maxLines} LOC per file).`);
console.log("Top 10 largest files:");
for (const item of largest) {
  const flagged = item.lines > maxLines && !LOC_EXCEPTIONS.has(item.path) ? "  <-- OVER" : "";
  const exempt = LOC_EXCEPTIONS.has(item.path) ? "  (exempt)" : "";
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
