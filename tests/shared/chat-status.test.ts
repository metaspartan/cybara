import { describe, expect, test } from "bun:test";
import {
  isGenericChatStatusLabel,
  isProviderRecoveryStatusLabel,
  isVisibleActivityText,
} from "../../shared/chat-status";

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

  test("handles malformed activity labels without crashing", () => {
    for (const value of [undefined, null, 42, {}, ""]) {
      expect(isProviderRecoveryStatusLabel(value)).toBe(false);
      expect(isGenericChatStatusLabel(value)).toBe(false);
      expect(isVisibleActivityText(value)).toBe(false);
    }
    expect(isVisibleActivityText("Read a file")).toBe(true);
    expect(isVisibleActivityText("Provider rate limited; retrying (1/3)...")).toBe(false);
  });
});
