import { describe, expect, test } from "bun:test";

describe("chat component organization", () => {
  test("keeps pending approval polling outside the main chat page", async () => {
    const chat = await Bun.file("ui/src/pages/Chat.tsx").text();
    const approvals = await Bun.file("ui/src/pages/chat/PendingApprovalsBanner.tsx").text();

    expect(chat).toContain(
      'import { PendingApprovalsBanner } from "./chat/PendingApprovalsBanner"'
    );
    expect(chat).not.toContain('apiFetch("/api/tools/approvals")');
    expect(approvals).toContain('apiFetch("/api/tools/approvals")');
    expect(approvals).toContain('apiFetch("/api/tools/approvals/resolve"');
  });
});
