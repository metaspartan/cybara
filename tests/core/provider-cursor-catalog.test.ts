import { describe, expect, test } from "bun:test";
import { providers } from "../../src/core/providers";
import { cursorModels } from "../../src/core/providers/cursor-models";

interface CatalogModel {
  id: string;
  name: string;
  context: number;
  maxTokens: number;
  reasoning: boolean;
  input: readonly string[];
}

const catalog = cursorModels as readonly CatalogModel[];
const find = (id: string): CatalogModel | undefined => catalog.find((model) => model.id === id);

describe("Cursor subscription catalog", () => {
  test("is wired to the Cursor provider entry", () => {
    expect(providers.cursor.models).toBe(cursorModels);
    expect(providers.cursor.baseUrl).toBe("https://api2.cursor.sh");
    expect(providers.cursor.api).toBe("cursor-agent");
  });

  test("exposes the Auto router Cursor picks for a model", () => {
    const auto = find("default");
    expect(auto).toBeDefined();
    expect(auto?.name).toBe("Auto");
    expect(auto?.input).toEqual(expect.arrayContaining(["text", "image"]));
  });

  test("covers every model family Cursor's picker offered", () => {
    const families = [
      "claude-opus-5",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5",
      "claude-fable-5-1",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "composer-2.5",
      "deepseek-v41-flash-1017",
      "gemini-3-flash",
      "gemini-3.1-pro",
      "gemini-3.5-flash",
      "gemini-3.8-flash",
      "gemini-4-argon",
      "glm-5.2",
      "glm-5p3",
      "glm-5p3-flash",
      "gpt-5.1",
      "gpt-5.2",
      "gpt-5.3-codex",
      "gpt-5.4",
      "gpt-5.5",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "grok-4.5",
      "grok-4.6",
      "grok-4.7",
      "kimi-k2.7-code",
      "kimi-k3",
      "muse-spark-1.3",
      "muse-wonder-1.0",
    ];
    for (const family of families) {
      expect(
        catalog.some((model) => model.id === family || model.id.startsWith(`${family}-`)),
        family
      ).toBe(true);
    }
  });

  test("keeps the reasoning variants Cursor renamed to cursor-prefixed ids", () => {
    for (const id of [
      "cursor-grok-4.5-high",
      "cursor-grok-4.5-high-fast",
      "cursor-grok-4.6-xhigh",
      "cursor-grok-4.6-xhigh-fast",
    ]) {
      expect(find(id), id).toBeDefined();
    }
  });

  test("keeps Cursor's own backward-compatible ids for renamed models", () => {
    for (const id of ["grok-4.7", "grok-4.5-medium", "grok-4.5-fast-xhigh", "gemini-4-argon"]) {
      expect(find(id), id).toBeDefined();
    }
  });

  test("no longer lists the retired Cursor models", () => {
    for (const id of [
      "composer-1",
      "composer-1.5",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5.2-codex-xhigh",
      "gpt-5.3-codex-spark-preview",
      "gemini-3-pro",
      "grok-code-fast-1",
      "kimi-k2.5",
    ]) {
      expect(find(id), id).toBeUndefined();
    }
  });

  test("every model has a unique id, a name and positive limits", () => {
    const ids = new Set<string>();
    for (const model of catalog) {
      expect(ids.has(model.id), model.id).toBe(false);
      ids.add(model.id);
      expect(model.name.trim().length, model.id).toBeGreaterThan(0);
      expect(model.context, model.id).toBeGreaterThan(0);
      expect(model.maxTokens, model.id).toBeGreaterThan(0);
      expect(model.maxTokens, model.id).toBeLessThanOrEqual(model.context);
      expect(model.input.length, model.id).toBeGreaterThan(0);
      expect(model.input).toContain("text");
    }
  });

  test("reports the context window Cursor publishes for each variant", () => {
    expect(find("claude-opus-5-high")?.context).toBe(300_000);
    expect(find("gpt-5.6-sol-high")?.context).toBe(272_000);
    expect(find("gemini-4-argon-high")?.context).toBe(1_000_000);
    expect(find("kimi-k3-high")?.context).toBe(1_048_576);
    expect(find("grok-4.7-high")?.context).toBe(256_000);
    expect(find("cursor-grok-4.6-xhigh")?.context).toBe(256_000);
  });

  test("marks image support only for the models Cursor serves images to", () => {
    expect(find("claude-opus-5-high")?.input).toContain("image");
    expect(find("grok-4.7-high")?.input).toEqual(["text"]);
  });

  test("names each variant with the effort Cursor shows in its picker", () => {
    expect(find("gpt-5.6-sol-high")?.name).toBe("GPT-5.6 Sol High");
    expect(find("gpt-5.6-sol-high-fast")?.name).toBe("GPT-5.6 Sol High Fast");
    expect(find("grok-4.7-xhigh")?.name).toBe("Grok 4.7 Extra High");
    expect(find("claude-opus-5")?.name).toBe("Claude Opus 5");
  });
});
