import { describe, expect, test } from "bun:test";
import { createHapticPolicy } from "../../apps/mobile/src/lib/hapticPolicy";

describe("mobile haptic policy", () => {
  test("blocks every event until the saved preference is loaded", () => {
    const policy = createHapticPolicy();
    expect(policy.isEnabled()).toBe(false);
    expect(policy.shouldRun("selection", 100)).toBe(false);
    expect(policy.shouldRun("agent_progress", 100)).toBe(false);
  });

  test("allows regular feedback while enabled", () => {
    const policy = createHapticPolicy();
    policy.setEnabled(true);
    expect(policy.isEnabled()).toBe(true);
    expect(policy.shouldRun("message_sent", 100)).toBe(true);
    expect(policy.shouldRun("agent_start", 101)).toBe(true);
    expect(policy.shouldRun("agent_complete", 102)).toBe(true);
  });

  test("throttles agent progress without suppressing completion", () => {
    const policy = createHapticPolicy(1400);
    policy.setEnabled(true);
    expect(policy.shouldRun("agent_progress", 1000)).toBe(true);
    expect(policy.shouldRun("agent_progress", 2399)).toBe(false);
    expect(policy.shouldRun("agent_complete", 2399)).toBe(true);
    expect(policy.shouldRun("agent_progress", 2400)).toBe(true);
  });

  test("disabling clears progress timing for the next enabled run", () => {
    const policy = createHapticPolicy(1400);
    policy.setEnabled(true);
    expect(policy.shouldRun("agent_progress", 1000)).toBe(true);
    policy.setEnabled(false);
    expect(policy.shouldRun("agent_progress", 1200)).toBe(false);
    policy.setEnabled(true);
    expect(policy.shouldRun("agent_progress", 1200)).toBe(true);
  });
});
