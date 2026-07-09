import { describe, expect, test } from "bun:test";

const sheetSource = await Bun.file(
  new URL("../../apps/mobile/src/screens/dashboardSubagents.tsx", import.meta.url)
).text();
const chatSource = await Bun.file(
  new URL("../../apps/mobile/src/screens/dashboardSessionDetail.tsx", import.meta.url)
).text();

describe("mobile subagent parity", () => {
  test("supports current-chat spawn, detail, stop, and clear actions", () => {
    expect(sheetSource).toContain("api.spawnSubagent");
    expect(sheetSource).toContain("api.subagent(selected.id)");
    expect(sheetSource).toContain("api.stopSubagent(selected.id)");
    expect(sheetSource).toContain("clearSubagent(selected.id)");
    expect(sheetSource).toContain("api.clearSubagentHistory(sessionId)");
    expect(sheetSource).toContain("selectable");
  });

  test("inherits the selected chat agent and workspace", () => {
    expect(chatSource).toContain("agentId={agentId}");
    expect(chatSource).toContain("workspaceDir={chatWorkspaceDir}");
    expect(sheetSource).toContain("requesterSessionId: sessionId");
  });
});
