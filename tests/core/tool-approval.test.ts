import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  approveToolAlways,
  approveToolForSession,
  buildApprovalKey,
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
    const pending = getPendingApprovals();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const req = pending.find((r) => r.toolName === "exec" && r.sessionId === "s1");
    expect(req).toBeDefined();

    resolveApproval(req!.id, "deny");
    const decision = await promise;
    expect(decision).toBe("deny");
  });

  test("aborting an active turn cancels its pending approval", async () => {
    config.set("tool_approval_mode", "ask");
    const controller = new AbortController();
    const promise = requestToolApproval({
      sessionId: "steered-session",
      toolName: "exec",
      argsSummary: "long command",
      abortSignal: controller.signal,
    });
    const request = getPendingApprovals().find(
      (candidate) => candidate.sessionId === "steered-session"
    );
    expect(request).toBeDefined();

    controller.abort(new DOMException("Conversation steered", "AbortError"));

    expect(await promise).toBe("deny");
    expect(getPendingApprovals().some((candidate) => candidate.id === request?.id)).toBe(false);
    expect(resolveApproval(request?.id || "", "approve_once")).toBe(false);
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

  test("approve_once does not add session approval for later calls", async () => {
    config.set("tool_approval_mode", "ask");
    const argsPreview = { command: "cat package.json" };
    const approvalKey = buildApprovalKey("exec", argsPreview);
    const promise = requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "cat package.json",
      argsPreview,
    });
    const req = getPendingApprovals().find((r) => r.approvalKey === approvalKey)!;
    resolveApproval(req.id, "approve_once");
    expect(await promise).toBe("approve_once");
    expect(isToolApproved("s1", approvalKey)).toBe(false);

    const second = requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "cat package.json",
      argsPreview,
    });
    const secondReq = getPendingApprovals().find((r) => r.status === "pending")!;
    expect(secondReq.approvalKey).toBe(approvalKey);
    resolveApproval(secondReq.id, "deny");
    expect(await second).toBe("deny");
  });

  test("approve_session is scoped to the original session and approval key", async () => {
    config.set("tool_approval_mode", "ask");
    const argsPreview = { command: "git status" };
    const approvalKey = buildApprovalKey("exec", argsPreview);
    const promise = requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "git status",
      argsPreview,
    });
    const req = getPendingApprovals().find((r) => r.approvalKey === approvalKey)!;
    resolveApproval(req.id, "approve_session");
    expect(await promise).toBe("approve_session");
    expect(isToolApproved("s1", approvalKey)).toBe(true);
    expect(isToolApproved("s2", approvalKey)).toBe(false);

    await expect(
      requestToolApproval({
        sessionId: "s1",
        toolName: "exec",
        argsSummary: "git status",
        argsPreview,
      })
    ).resolves.toBe("approve_session");

    const otherSession = requestToolApproval({
      sessionId: "s2",
      toolName: "exec",
      argsSummary: "git status",
      argsPreview,
    });
    const otherReq = getPendingApprovals().find(
      (r) => r.sessionId === "s2" && r.approvalKey === approvalKey
    )!;
    resolveApproval(otherReq.id, "deny");
    expect(await otherSession).toBe("deny");
  });
});

describe("tool-approval per-command scoping (security)", () => {
  test("buildApprovalKey binds command-bearing tools to their command", () => {
    expect(buildApprovalKey("exec", { command: "ls -la" })).toBe("exec ls -la");
    expect(buildApprovalKey("exec", { command: "rm -rf /" })).toBe("exec rm -rf /");
    expect(buildApprovalKey("execute_code", { code: "print(1)", language: "python" })).toBe(
      "execute_code print(1) python"
    );
    expect(buildApprovalKey("browser", { action: "navigate" })).toBe("browser");
    expect(buildApprovalKey("exec", undefined)).toBe("exec");
  });

  test("approving one command does NOT approve a different command of the same tool", () => {
    const benign = buildApprovalKey("exec", { command: "ls -la" });
    const dangerous = buildApprovalKey("exec", { command: "rm -rf ~" });
    approveToolForSession("s1", benign);
    expect(isToolApproved("s1", benign)).toBe(true);
    expect(isToolApproved("s1", dangerous)).toBe(false);
  });

  test("file mutation approvals bind the target and payload", () => {
    const original = buildApprovalKey("write", { path: "src/a.ts", content: "one" });
    expect(buildApprovalKey("write", { path: "src/a.ts", content: "one" })).toBe(original);
    expect(buildApprovalKey("write", { path: "src/a.ts", content: "two" })).not.toBe(original);
    expect(buildApprovalKey("write", { path: "src/b.ts", content: "one" })).not.toBe(original);
  });

  test("apply_patch dry runs cannot authorize a real write", () => {
    const dryRun = buildApprovalKey("apply_patch", {
      path: "src/a.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      dryRun: true,
    });
    const write = buildApprovalKey("apply_patch", {
      path: "src/a.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      dryRun: false,
    });

    expect(write).not.toBe(dryRun);
    approveToolForSession("s1", dryRun);
    expect(isToolApproved("s1", dryRun)).toBe(true);
    expect(isToolApproved("s1", write)).toBe(false);
  });

  test("requestToolApproval fast-path is scoped to the exact command", async () => {
    approveToolForSession("s1", buildApprovalKey("exec", { command: "ls" }));

    const approved = await requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "ls",
      argsPreview: { command: "ls" },
    });
    expect(approved).toBe("approve_session");

    config.set("tool_approval_mode", "ask");
    const pendingBefore = getPendingApprovals().length;
    const promise = requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "cat /etc/passwd",
      argsPreview: { command: "cat /etc/passwd" },
    });
    expect(getPendingApprovals().length).toBe(pendingBefore + 1);
    const req = getPendingApprovals().find((r) => r.argsSummary === "cat /etc/passwd")!;
    resolveApproval(req.id, "deny");
    expect(await promise).toBe("deny");
  });

  test("approve_session then re-run same command auto-approves; revoke clears all command grants", async () => {
    config.set("tool_approval_mode", "ask");
    const promise = requestToolApproval({
      sessionId: "s1",
      toolName: "exec",
      argsSummary: "git status",
      argsPreview: { command: "git status" },
    });
    const req = getPendingApprovals().find((r) => r.argsSummary === "git status")!;
    resolveApproval(req.id, "approve_session");
    expect(await promise).toBe("approve_session");

    expect(isToolApproved("s1", buildApprovalKey("exec", { command: "git status" }))).toBe(true);

    revokeToolApproval("exec", "s1");
    expect(isToolApproved("s1", buildApprovalKey("exec", { command: "git status" }))).toBe(false);
  });
});
