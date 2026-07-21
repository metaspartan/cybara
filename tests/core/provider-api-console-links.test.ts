import { describe, expect, test } from "bun:test";
import { providers } from "../../src/core/providers";
import {
  providerApiConsoleUrl,
  providerTypesWithApiConsole,
} from "../../src/core/providers/api-console-links";

describe("provider API console links", () => {
  test("covers hosted API-key and token providers", () => {
    const missing = Object.entries(providers)
      .filter(
        ([id, provider]) =>
          (provider.authType === "api_key" || provider.authType === "token") && id !== "litellm"
      )
      .filter(([id]) => providerApiConsoleUrl(id) === null)
      .map(([id]) => id);

    expect(missing).toEqual([]);
  });

  test("uses secure absolute console URLs", () => {
    for (const providerType of providerTypesWithApiConsole()) {
      const value = providerApiConsoleUrl(providerType);
      expect(value).not.toBeNull();
      expect(new URL(value || "").protocol).toBe("https:");
    }
  });

  test("does not invent a console for self-hosted or unknown providers", () => {
    expect(providerApiConsoleUrl("litellm")).toBeNull();
    expect(providerApiConsoleUrl("plugin-provider")).toBeNull();
  });
});
