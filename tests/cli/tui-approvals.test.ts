import { describe, expect, test } from "bun:test";
import {
  approvalDecisionForInput,
  approvalsFromResponse,
} from "../../src/cli/tui/components/approvals";

describe("CLI TUI tool approvals", () => {
  test("normalizes pending approval requests", () => {
    expect(
      approvalsFromResponse({
        pending: [
          {
            id: "approval-1",
            sessionId: "session-1",
            toolName: "exec",
            argsPreview: '{"command":"bun test"}',
            createdAt: 123,
          },
          { id: "invalid" },
        ],
      })
    ).toEqual([
      {
        id: "approval-1",
        sessionId: "session-1",
        toolName: "exec",
        argsPreview: '{"command":"bun test"}',
        createdAt: 123,
      },
    ]);
  });

  test("maps compact approval keys to scoped decisions", () => {
    expect(approvalDecisionForInput("1")).toBe("approve_once");
    expect(approvalDecisionForInput("s")).toBe("approve_session");
    expect(approvalDecisionForInput("A")).toBe("approve_always");
    expect(approvalDecisionForInput("n")).toBe("deny");
    expect(approvalDecisionForInput("z")).toBeNull();
  });

  test("rejects malformed API payloads without throwing", () => {
    expect(approvalsFromResponse(null)).toEqual([]);
    expect(approvalsFromResponse({ pending: "invalid" })).toEqual([]);
    expect(approvalsFromResponse({ pending: [null, 1, "request"] })).toEqual([]);
  });
});
