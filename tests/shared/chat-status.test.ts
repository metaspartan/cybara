import { describe, expect, test } from "bun:test";
import {
  delegatedRunWaitCount,
  formatDelegatedRunWaitLabel,
  isDelegatedWaitStatusLabel,
  isGenericChatStatusLabel,
  isProviderRecoveryStatusLabel,
  isVisibleActivityText,
} from "../../shared/chat-status";

describe("chat status labels", () => {
  test("recognizes delegated wait lifecycle labels", () => {
    expect(isDelegatedWaitStatusLabel("Waiting for 1 delegated task...")).toBe(true);
    expect(isDelegatedWaitStatusLabel("Waiting for 3 delegated tasks...")).toBe(true);
    expect(isDelegatedWaitStatusLabel("Running 1 task…")).toBe(true);
    expect(isDelegatedWaitStatusLabel("Running 3 tasks…")).toBe(true);
    expect(delegatedRunWaitCount("Running 3 tasks…")).toBe(3);
    expect(delegatedRunWaitCount("Waiting for 1 delegated task...")).toBe(1);
    expect(formatDelegatedRunWaitLabel(1)).toBe("Running 1 task…");
    expect(formatDelegatedRunWaitLabel(4)).toBe("Running 4 tasks…");
    expect(isDelegatedWaitStatusLabel("Waiting for task...")).toBe(false);
    expect(isDelegatedWaitStatusLabel("Generating response...")).toBe(false);
  });

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
