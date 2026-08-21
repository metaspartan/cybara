import { describe, expect, test } from "bun:test";
import {
  resolveProviderModelApiFamily,
  supportsExplicitToolChoice,
  supportsForcedToolChoice,
} from "../../src/core/llm/provider-model-transport";

describe("provider model transport", () => {
  test("resolves model overrides before the provider default", () => {
    const models = [{ id: "glm-5.2" }, { id: "MiniMax-M3", api: "anthropic-messages" }];

    expect(resolveProviderModelApiFamily("openai-completions", models, "minimax-m3")).toBe(
      "anthropic-messages"
    );
    expect(resolveProviderModelApiFamily("openai-completions", models, "glm-5.2")).toBe(
      "openai-completions"
    );
  });

  test("uses automatic tool choice for OpenCode Go", () => {
    expect(supportsForcedToolChoice("opencode-go")).toBe(false);
    expect(supportsForcedToolChoice("opencode-go-zen")).toBe(false);
    expect(supportsForcedToolChoice("inference")).toBe(false);
    expect(supportsForcedToolChoice("openai")).toBe(true);
  });

  test("identifies providers that reject explicit tool choice", () => {
    expect(supportsExplicitToolChoice("inference")).toBe(false);
    expect(supportsExplicitToolChoice("opencode-go")).toBe(true);
    expect(supportsExplicitToolChoice("openai")).toBe(true);
  });
});
