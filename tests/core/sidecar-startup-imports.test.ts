import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

const srcDir = fileURLToPath(new URL("../../src", import.meta.url));
const read = (rel: string) => readFileSync(`${srcDir}/${rel}`, "utf8");

describe("compiled sidecar startup: native/heavy externals must load lazily", () => {
  test("embeddings.ts routes heavy externals through the parameterized loader", () => {
    const source = read("core/memory/embeddings.ts");
    expect(source).toContain("importOptionalModule");
    expect(source).not.toMatch(/import\(\s*["']@huggingface\/transformers["']\s*\)/);
    expect(source).not.toMatch(/import\(\s*["']onnxruntime-node["']\s*\)/);
    expect(source).not.toMatch(/import\(\s*["']onnxruntime-web["']\s*\)/);
  });

  test("no source file statically imports @huggingface/transformers or onnxruntime", async () => {
    const glob = new Glob("**/*.ts");
    const offenders: string[] = [];
    for await (const rel of glob.scan({ cwd: srcDir })) {
      const source = readFileSync(`${srcDir}/${rel}`, "utf8");
      for (const line of source.split("\n")) {
        if (
          /^\s*import\s.+from\s+["'](@huggingface\/transformers|onnxruntime-node|onnxruntime-web)["']/.test(
            line
          )
        ) {
          offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no source file statically value-imports playwright (type-only is fine)", async () => {
    const glob = new Glob("**/*.ts");
    const offenders: string[] = [];
    for await (const rel of glob.scan({ cwd: srcDir })) {
      const source = readFileSync(`${srcDir}/${rel}`, "utf8");
      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        if (!/from\s+["']playwright["']/.test(trimmed)) continue;
        if (trimmed.startsWith("import type")) continue;
        offenders.push(`${rel}: ${trimmed}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the orphaned transformers-runtime wrapper is gone", () => {
    expect(existsSync(`${srcDir}/core/memory/transformers-runtime.ts`)).toBe(false);
  });
});
