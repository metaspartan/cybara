import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const uiSrc = fileURLToPath(new URL("../../ui/src", import.meta.url));
const read = (rel: string) => readFileSync(`${uiSrc}/${rel}`, "utf8");

describe("Memory and Settings pages: memory controls", () => {
  const memory = read("pages/Memory.tsx");
  const settings = read("pages/Settings.tsx");

  test("keeps durable memory editing separate from recall configuration", () => {
    expect(memory).toContain("Memory Store");
    expect(memory).toContain("Settings &gt; AI &amp; Memory");
    expect(memory).not.toContain("handleChangeMethod");
    expect(memory).not.toContain("workspace_indexer: next");
    expect(memory).not.toContain("Memory Settings");
  });

  test("renders recall provider controls with the supported providers in Settings", () => {
    expect(settings).toContain("MemoryRecallSettingsState");
    expect(settings).toContain("memoryRecallProviderOptions");
    for (const provider of [
      "auto",
      "local",
      "transformers_js",
      "openai",
      "voyage",
      "gemini",
      "ollama",
    ]) {
      expect(settings).toMatch(new RegExp(`value: ["']${provider}["']`));
    }
    // Popular models are offered as a dropdown per provider, with a custom escape hatch.
    expect(settings).toContain("memoryRecallModelSuggestions");
    expect(settings).toContain("Custom model…");
  });

  test("persists memory behavior, provider, and recall settings to gateway config", () => {
    expect(settings).toContain("settingsApi.updateConfig({ memory, memory_provider: provider })");
    expect(settings).toContain("workspace_indexer: memoryRecallConfigPayload(recall)");
    expect(settings).toContain("embeddingProvider: recall.embeddingProvider");
  });

  test("loads memory behavior and recall settings from config on mount", () => {
    expect(settings).toContain("settingsApi.getConfig()");
    expect(settings).toContain("result.data?.memory");
    expect(settings).toContain("result.data?.workspace_indexer");
  });

  test("exposes robust workspace indexer settings from Settings", () => {
    for (const setting of [
      "semanticEnabled",
      "semanticMaxFiles",
      "semanticMinScore",
      "maxFileSizeBytes",
      "maxFiles",
      "includeHidden",
      "autoReindexOnWorkspaceSet",
    ]) {
      expect(settings).toContain(setting);
    }
    // Indexing is its own card now, and the external-provider picker replaced
    // the old "Active memory stack" placeholder note.
    expect(settings).toContain("Save Indexing Settings");
    expect(settings).toContain("Memory provider");
    expect(settings).toContain("memoryApi.testProvider(");
    expect(settings).not.toContain("Active memory stack");
  });

  test("keeps memory search file metadata so entries can be edited or deleted", () => {
    expect(memory).toContain("type MemorySearchResult");
    expect(memory).toContain("memorySearchResults.map(({ file, entry }");
    expect(memory).toContain("setEditingEntry({ file, entry })");
    expect(memory).toContain("setDeletingEntry({ file, index: entry.index ?? 0 })");
    expect(memory).not.toContain("opacity-0 group-hover:opacity-100");
  });
});
