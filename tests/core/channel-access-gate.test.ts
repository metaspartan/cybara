import { describe, expect, test } from "bun:test";
import { evaluateChannelAccess } from "../../src/core/channels/access-gate";
import { securityManager } from "../../src/core/channels/security";

describe("evaluateChannelAccess", () => {
  test("open dm policy permits anyone", () => {
    securityManager.setConfig("ch-open", { dm_policy: "open" });
    const d = evaluateChannelAccess("ch-open", "user-1", "feishu", { isGroup: false });
    expect(d.permitted).toBe(true);
  });

  test("disabled dm policy blocks with no reply spam", () => {
    securityManager.setConfig("ch-disabled", { dm_policy: "disabled" });
    const d = evaluateChannelAccess("ch-disabled", "user-1", "feishu", { isGroup: false });
    expect(d.permitted).toBe(false);
  });

  test("allowlist blocks unknown sender and permits allowed sender", () => {
    securityManager.setConfig("ch-allow", {
      dm_policy: "allowlist",
      allowed_senders: ["trusted-user"],
    });
    expect(
      evaluateChannelAccess("ch-allow", "stranger", "matrix", { isGroup: false }).permitted
    ).toBe(false);
    expect(
      evaluateChannelAccess("ch-allow", "trusted-user", "matrix", { isGroup: false }).permitted
    ).toBe(true);
  });

  test("pairing policy blocks new sender but returns a pairing code reply", () => {
    securityManager.setConfig("ch-pair", { dm_policy: "pairing" });
    const d = evaluateChannelAccess("ch-pair", "new-user", "ntfy", { isGroup: false });
    expect(d.permitted).toBe(false);
    expect(d.reply).toContain("Pairing code");
  });

  test("group owner_only stays silent for non-owner (no group spam)", () => {
    securityManager.setConfig("ch-group", {
      group_policy: "owner_only",
      group_owner_sender_id: "boss",
    });
    const nonOwner = evaluateChannelAccess("ch-group", "rando", "irc", {
      isGroup: true,
    });
    expect(nonOwner.permitted).toBe(false);
    expect(nonOwner.reply).toBeUndefined();

    const owner = evaluateChannelAccess("ch-group", "boss", "irc", { isGroup: true });
    expect(owner.permitted).toBe(true);
  });

  test("unconfigured channel defaults to pairing (closed by default)", () => {
    const d = evaluateChannelAccess("ch-never-configured", "someone", "zulip", {
      isGroup: false,
    });
    expect(d.permitted).toBe(false);
  });
});
