import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const uiSrc = fileURLToPath(new URL("../../ui/src", import.meta.url));
const read = (rel: string) => readFileSync(`${uiSrc}/${rel}`, "utf8");

describe("Memory page: embedding method toggle", () => {
  const memory = read("pages/Memory.tsx");

  test("renders a method selector with the supported providers", () => {
    expect(memory).toContain("handleChangeMethod");
    for (const provider of ["auto", "transformers_js", "openai", "gemini", "ollama"]) {
      expect(memory).toContain(`value="${provider}"`);
    }
  });

  test("persists the method to the gateway via workspace_indexer.embeddingProvider", () => {
    expect(memory).toMatch(
      /updateConfig\(\{\s*workspace_indexer:\s*\{\s*embeddingProvider:/
    );
  });

  test("loads the current method from config on mount", () => {
    expect(memory).toContain("settingsApi.getConfig()");
    expect(memory).toContain("embeddingProvider");
  });
});
