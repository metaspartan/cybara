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
      expect(memory).toContain(`value: '${provider}'`);
    }
    expect(memory).not.toContain('value="voyage"');
  });

  test("persists the method to the gateway via workspace_indexer.embeddingProvider", () => {
    expect(memory).toContain("settingsApi.updateConfig({");
    expect(memory).toContain("workspace_indexer: next");
    expect(memory).toContain("handleChangeMethod");
  });

  test("loads the current method from config on mount", () => {
    expect(memory).toContain("settingsApi.getConfig()");
    expect(memory).toContain("embeddingProvider");
  });

  test("exposes robust workspace indexer settings from the memory page", () => {
    for (const setting of [
      "semanticEnabled",
      "semanticMaxFiles",
      "semanticMinScore",
      "maxFileSizeBytes",
      "maxFiles",
      "includeHidden",
      "autoReindexOnWorkspaceSet",
    ]) {
      expect(memory).toContain(setting);
    }
    expect(memory).toContain("Memory Settings");
    expect(memory).toContain("Settings are shared with workspace search and IDE indexing.");
  });

  test("keeps memory search file metadata so entries can be edited or deleted", () => {
    expect(memory).toContain("type MemorySearchResult");
    expect(memory).toContain("memorySearchResults.map(({ file, entry }");
    expect(memory).toContain("setEditingEntry({ file, entry })");
    expect(memory).toContain("setDeletingEntry({ file, index: entry.index ?? 0 })");
    expect(memory).not.toContain("opacity-0 group-hover:opacity-100");
  });
});
