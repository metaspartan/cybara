import { describe, expect, test } from "bun:test";
import { onStatusStream, statusStreamListenerCount } from "../../src/core/status";
import { canWaitForToolApproval, UNATTENDED_APPROVAL_MESSAGE } from "../../src/core/tool-approval";
import { isToolPolicyBlockedMessage } from "../../src/core/tool-result-classification";

describe("unattended tool approval", () => {
  test("web and API runs cannot wait for approval when no app is connected", () => {
    expect(statusStreamListenerCount()).toBe(0);
    expect(canWaitForToolApproval(undefined)).toBe(false);
    expect(canWaitForToolApproval("web")).toBe(false);
    expect(canWaitForToolApproval("api")).toBe(false);
  });

  test("a connected app or a chat channel can still approve", () => {
    expect(canWaitForToolApproval("telegram")).toBe(true);
    const unsubscribe = onStatusStream(() => undefined);
    try {
      expect(statusStreamListenerCount()).toBe(1);
      expect(canWaitForToolApproval(undefined)).toBe(true);
    } finally {
      unsubscribe();
    }
    expect(statusStreamListenerCount()).toBe(0);
  });

  test("the unattended denial is classified like any operator denial and says how to fix it", () => {
    const message = `Tool 'write' was denied by the operator. It ${UNATTENDED_APPROVAL_MESSAGE}`;
    expect(isToolPolicyBlockedMessage(message)).toBe(true);
    expect(message).toContain("Always Allow");
  });
});
