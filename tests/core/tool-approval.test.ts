import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  approveToolAlways,
  approveToolForSession,
  getAlwaysAllowlist,
  getPendingApprovals,
  isToolApproved,
  resetApprovalStateForTests,
  resolveApproval,
  requestToolApproval,
  revokeToolApproval,
} from "../../src/core/tool-approval";

afterEach(() => {
  resetApprovalStateForTests();
  config.set("tool_approval_mode", "always_allow");
});

describe("tool-approval allowlist", () => {
  test("isToolApproved is false by default", () => {
    expect(isToolApproved("s1", "exec")).toBe(false);
  });

  test("session approval is scoped to a session", () => {
    approveToolForSession("s1", "exec");
    expect(isToolApproved("s1", "exec")).toBe(true);
    expect(isToolApproved("s2", "exec")).toBe(false);
  });

  test("always approval is global", () => {
    approveToolAlways("git");
    expect(isToolApproved("any-session", "git")).toBe(true);
    expect(getAlwaysAllowlist()).toContain("git");
  });

  test("revoke removes session + always approvals", () => {
    approveToolAlways("wallet");
    approveToolForSession("s1", "exec");
    revokeToolApproval("wallet");
    revokeToolApproval("exec", "s1");
    expect(isToolApproved("s1", "wallet")).toBe(false);
    expect(isToolApproved("s1", "exec")).toBe(false);
  });
});

describe("tool-approval request + resolve", () => {
  test("request returns immediately if tool is already approved", async () => {
    approveToolForSession("s1", "exec");
    const decision = await requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "ls",
    });
    expect(decision).toBe("approve_session");
  });

  test("pending request can be resolved", async () => {
    config.set("tool_approval_mode", "ask");
    const promise = requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "rm -rf /",
    });
    // There should be a pending request.
    const pending = getPendingApprovals();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const req = pending.find((r) => r.toolName === "exec" && r.sessionId === "s1");
    expect(req).toBeDefined();

    // Resolve it.
    resolveApproval(req!.id, "deny");
    const decision = await promise;
    expect(decision).toBe("deny");
  });

  test("approve_always adds to the global allowlist", async () => {
    config.set("tool_approval_mode", "ask");
    const promise = requestToolApproval({
      sessionId: "s1",
      toolName: "browser",
      argsSummary: "navigate",
    });
    const pending = getPendingApprovals();
    const req = pending[0];
    resolveApproval(req.id, "approve_always");
    await promise;
    expect(getAlwaysAllowlist()).toContain("browser");
  });
});
