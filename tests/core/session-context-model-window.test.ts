import { describe, expect, test } from "bun:test";
import db, { tables } from "../../src/core/database";
import { getContextWindow } from "../../src/core/session-context";

describe("session context model window", () => {
  test("ignores stale generic discovery limits for Kimi K3", () => {
    const providerId = `kimi-context-${crypto.randomUUID()}`;
    tables.providers.create({
      id: providerId,
      provider: "kimi-code-oauth",
      name: "Kimi Context Test",
      base_url: "https://api.kimi.com/coding/v1",
      is_default: false,
    });
    tables.providerModels.upsert({
      id: `${providerId}-fallback`,
      provider_id: providerId,
      model_id: "k3",
      model_name: "k3",
      context_window: 128000,
      max_tokens: 8192,
      reasoning: false,
      input_types: ["text"],
    });

    expect(getContextWindow("k3")).toBe(1_048_576);

    db.query("DELETE FROM provider_models WHERE provider_id = ?").run(providerId);
    tables.providers.delete(providerId);
  });
});
