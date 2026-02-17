import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const uiSrcDir = fileURLToPath(new URL("../../ui/src", import.meta.url));
const fetchApiPattern = /fetch\(\s*(?:`\/api|['"]\/api|`\$\{API_BASE\}\/api)/g;
const eventSourcePattern = /new\s+EventSource\(\s*(?:`\/api|['"]\/api)/g;
const webSocketPattern =
  /new\s+WebSocket\(\s*(?:`(?:wss?:\/\/[^`]*\/api|\/api)|['"](?:wss?:\/\/[^'"]*\/api|\/api))/g;

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("UI API access discipline", () => {
  test("no direct fetch('/api/...') calls exist in ui/src", () => {
    const violations: string[] = [];
    const files = listSourceFiles(uiSrcDir);

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (fetchApiPattern.test(content)) {
        const relative = file.startsWith(uiSrcDir) ? file.slice(uiSrcDir.length + 1) : file;
        violations.push(relative);
      }
      fetchApiPattern.lastIndex = 0;
    }

    expect(violations).toEqual([]);
  });

  test("no raw EventSource/WebSocket API URLs bypass token helpers", () => {
    const violations: string[] = [];
    const files = listSourceFiles(uiSrcDir);

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (eventSourcePattern.test(content) || webSocketPattern.test(content)) {
        const relative = file.startsWith(uiSrcDir) ? file.slice(uiSrcDir.length + 1) : file;
        violations.push(relative);
      }
      eventSourcePattern.lastIndex = 0;
      webSocketPattern.lastIndex = 0;
    }

    expect(violations).toEqual([]);
  });
});
