import { describe, expect, test } from "bun:test";
import { agentSupportsImages } from "../../src/core/agent-image-capabilities";
import { providerManager } from "../../src/core/providers";

describe("agent image capabilities", () => {
  test("uses provider model metadata instead of model-name guesses", () => {
    const provider = providerManager.create({
      name: "Image capability test",
      provider: "minimax",
      api_key: "test-key",
    });
    expect(agentSupportsImages({ provider_id: provider.id, model: "MiniMax-M3" })).toBe(true);
    expect(agentSupportsImages({ provider_id: provider.id, model: "MiniMax-M2.7" })).toBe(false);
  });
});
