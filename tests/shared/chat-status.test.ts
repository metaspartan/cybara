import { describe, expect, test } from "bun:test";
import { isGenericChatStatusLabel, isProviderRecoveryStatusLabel } from "../../shared/chat-status";

describe("chat status labels", () => {
  test("classifies transient provider recovery as internal status", () => {
    for (const value of [
      "Provider connection interrupted; retrying (1/5)...",
      "Provider rate limited; retrying (2/5)...",
      "Provider temporarily unavailable; retrying (3/5)...",
      "Provider session refreshed; continuing...",
    ]) {
      expect(isProviderRecoveryStatusLabel(value)).toBe(true);
      expect(isGenericChatStatusLabel(value)).toBe(true);
    }
  });

  test("keeps terminal provider failures visible", () => {
    expect(isProviderRecoveryStatusLabel("Provider authentication failed (401).")).toBe(false);
    expect(isProviderRecoveryStatusLabel("Provider rate limit hit (429).")).toBe(false);
  });
});
