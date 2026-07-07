import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { normalizeMactopSampleCount } from "../../src/core/tools/mactop";

const root = join(import.meta.dir, "..", "..");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("mactop tool safety", () => {
  test("normalizes sample counts before execution", () => {
    expect(normalizeMactopSampleCount("4", 3, 10)).toBe(4);
    expect(normalizeMactopSampleCount("4; echo pwned", 3, 10)).toBe(3);
    expect(normalizeMactopSampleCount(-1, 3, 10)).toBe(3);
    expect(normalizeMactopSampleCount(999, 3, 10)).toBe(10);
    expect(normalizeMactopSampleCount(2.9, 3, 10)).toBe(2);
  });

  test("mactop handlers do not invoke a shell", () => {
    const toolSource = readFileSync(join(root, "src/core/tools/handlers/index.ts"), "utf8");
    const toolBlock = sourceBetween(toolSource, "mactop: async", "\n\n  browser:");
    expect(toolBlock).not.toContain('"sh"');
    expect(toolBlock).not.toContain('"-c"');
    expect(toolBlock).not.toContain("'-c'");
    expect(toolBlock).toContain("runMactopJsonSamples");

    const skillSource = readFileSync(join(root, "src/core/skills/index.ts"), "utf8");
    const skillBlock = sourceBetween(
      skillSource,
      "builtinExecutors.mactop",
      "\n\nexport async function getSkillExecutors"
    );
    expect(skillBlock).not.toContain('"sh"');
    expect(skillBlock).not.toContain('"-c"');
    expect(skillBlock).not.toContain("'-c'");
    expect(skillBlock).toContain("runMactopJsonSamples");
  });
});
