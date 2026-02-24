import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pagesDir = fileURLToPath(new URL("../../ui/src/pages", import.meta.url));

function readPage(fileName: string): string {
  return readFileSync(join(pagesDir, fileName), "utf8");
}

describe("UI page API wiring", () => {
  test("Channels page routes pairing and test actions through channelsApi helpers", () => {
    const source = readPage("Channels.tsx");

    expect(source).toContain('import { channelsApi } from "@/lib/api";');
    expect(source).toContain("channelsApi.getPairings(channelId)");
    expect(source).toContain("channelsApi.verifyPairing(securityChannel.id, code.toUpperCase())");
    expect(source).toContain("channelsApi.rejectPairing(securityChannel.id, pairingId)");
    expect(source).toContain("channelsApi.test(channel.id)");
    expect(source).toContain("if (securityChannel) {");
    expect(source).toContain("fetchPairings(securityChannel.id);");
    expect(source).toContain('setPairingCode("");');
    expect(source).not.toContain("apiFetch(");
  });

  test("Settings feature toggle uses settingsApi and restores state on update failure", () => {
    const source = readPage("Settings.tsx");

    expect(source).toContain("import { settingsApi } from '@/lib/api';");
    expect(source).toContain("settingsApi.getConfig()");
    expect(source).toContain("settingsApi.updateConfig({ terminal_enabled: enabled })");
    expect(source).toContain("settingsApi.updateConfig({ dangerous_tool_policy: next })");
    expect(source).toContain("settingsApi.updateConfig({ tool_approval_mode: nextMode })");
    expect(source).toContain("setTerminalEnabled(enabled);");
    expect(source).toContain("setTerminalEnabled(!enabled);");
    expect(source).not.toContain("apiFetch(");
  });

  test("Setup page completes onboarding through setupApi helper", () => {
    const source = readPage("Setup.tsx");

    expect(source).toContain("import { setupApi, settingsApi } from '@/lib/api';");
    expect(source).toContain("setupApi.complete()");
    expect(source).toContain("settingsApi.updateConfig({ tool_approval_mode: toolApprovalMode })");
    expect(source).not.toContain("apiFetch('/api/setup/complete'");
  });

  test("Providers page keeps OAuth flows on expected backend routes", () => {
    const source = readPage("Providers.tsx");

    expect(source).toContain("apiFetch('/api/providers/oauth/device-code'");
    expect(source).toContain("apiFetch('/api/providers/oauth/poll'");
    expect(source).toContain("apiFetch('/api/providers/oauth/start'");
    expect(source).toContain("apiFetch('/api/providers/oauth/callback-status'");
    expect(source).toContain("apiFetch(`/api/providers/${provider.id}/test`");
    expect(source).toContain("openExternal(data.verification_uri)");
    expect(source).toContain("openExternal(data.auth_url)");
  });

  test("IDE page routes file and git operations through encoded API paths", () => {
    const source = readPage("IDE.tsx");

    expect(source).toContain("apiFetch(`/api/ide/browse?path=${encodeURIComponent(path)}`)");
    expect(source).toContain("apiFetch(`/api/ide/read?path=${encodeURIComponent(path)}`)");
    expect(source).toContain('apiFetch("/api/ide/write",');
    expect(source).toContain('apiFetch("/api/ide/create",');
    expect(source).toContain(
      "apiFetch(`/api/lsp/diagnostics/file?path=${encodeURIComponent(path)}`)"
    );
    expect(source).toContain('apiFetch("/api/lsp/languages")');
    expect(source).toContain("apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`)");
  });

  test("IDE page includes quick navigation controls for filtering and line jump", () => {
    const source = readPage("IDE.tsx");

    expect(source).toContain('placeholder="Filter files"');
    expect(source).toContain('setTreeFilter("")');
    expect(source).toContain("lineJumpInputRef.current?.focus()");
    expect(source).toContain('e.key.toLowerCase() === "g"');
    expect(source).toContain("data-line-number={i + 1}");
  });

  test("Terminal page uses token-aware websocket URL helper", () => {
    const source = readPage("Terminal.tsx");

    expect(source).toContain(
      "appendApiTokenParam(`/api/terminal/ws?session=${encodeURIComponent(id)}`)"
    );
    expect(source).toContain("apiFetch('/api/terminal/sessions')");
    expect(source).toContain("new WebSocket(`${proto}//${window.location.host}${wsPath}`)");
  });

  test("Tasks page loads run history through tasksApi helper", () => {
    const source = readPage("Tasks.tsx");

    expect(source).toContain("import { tasksApi } from '@/lib/api';");
    expect(source).toContain("tasksApi.getRuns(expandedTaskId)");
    expect(source).not.toContain("apiFetch(`/api/tasks/${expandedTaskId}/runs`)");
  });

  test("Memory page creates files through memoryApi helper", () => {
    const source = readPage("Memory.tsx");

    expect(source).toContain("import { memoryApi } from '@/lib/api';");
    expect(source).toContain("memoryApi.createFile(file, content)");
    expect(source).not.toContain("apiFetch('/api/memory'");
  });

  test("Artifacts page loads registry and content through chatApi artifact helpers", () => {
    const source = readPage("Artifacts.tsx");

    expect(source).toContain("chatApi.listArtifacts()");
    expect(source).toContain("chatApi.readSessionArtifact(selected.sessionId, selected.fileName)");
    expect(source).toContain("rawView");
    expect(source).toContain("Markdown");
    expect(source).toContain("Raw");
  });

  test("Logs and Sessions pages use shared API clients", () => {
    const logsSource = readPage("Logs.tsx");
    const sessionsSource = readPage("Sessions.tsx");

    expect(logsSource).toContain("import { logsApi } from '@/lib/api';");
    expect(logsSource).toContain("logsApi.getSystem()");
    expect(logsSource).toContain("logsApi.getStats(24)");
    expect(logsSource).toContain("logsApi.search(searchQuery)");
    expect(logsSource).not.toContain("apiFetch(");

    expect(sessionsSource).toContain("import { sessionsApi } from '@/lib/api';");
    expect(sessionsSource).toContain("sessionsApi.list()");
    expect(sessionsSource).toContain("sessionsApi.get(session.id)");
    expect(sessionsSource).toContain("sessionsApi.delete(sessionToDelete.id)");
    expect(sessionsSource).not.toContain("apiFetch(");
  });

  test("MCPServers page uses shared mcpApi client helpers", () => {
    const source = readPage("MCPServers.tsx");

    expect(source).toContain("import { mcpApi");
    expect(source).toContain("mcpApi.list()");
    expect(source).toContain("mcpApi.popular()");
    expect(source).toContain("mcpApi.search(searchQuery)");
    expect(source).toContain("mcpApi.install({ id: server.id })");
    expect(source).toContain("mcpApi.start(id)");
    expect(source).toContain("mcpApi.stop(id)");
    expect(source).toContain("mcpApi.delete(id)");
    expect(source).toContain("mcpApi.create({");
    expect(source).not.toContain("apiFetch(");
  });

  test("Wallet page uses shared walletApi helpers", () => {
    const source = readPage("Wallet.tsx");

    expect(source).toContain("import {");
    expect(source).toContain("walletApi");
    expect(source).toContain("walletApi.status()");
    expect(source).toContain("walletApi.rpc()");
    expect(source).toContain("walletApi.rpcStatus()");
    expect(source).toContain("walletApi.getAgentPolicy()");
    expect(source).toContain("walletApi.accounts(");
    expect(source).toContain("walletApi.balances(");
    expect(source).toContain("walletApi.tokenBalances(");
    expect(source).toContain("walletApi.tokenTransactions(");
    expect(source).toContain("walletApi.transactions(");
    expect(source).toContain("walletApi.send(");
    expect(source).toContain("walletApi.sendToken(");
    expect(source).toContain("walletApi.setAgentAccess(");
    expect(source).toContain("walletApi.updateAgentPolicy(");
    expect(source).toContain("walletApi.updateRpc(");
    expect(source).toContain("walletApi.deleteWallet(");
    expect(source).toContain("WALLET_TABS");
    expect(source).toContain('Type "DELETE" to confirm');
    expect(source).not.toContain("globalThis.confirm");
    expect(source).not.toContain("globalThis.prompt");
    expect(source).not.toContain("apiFetch(");
  });

  test("Agents page sends provider_id in create/update payloads", () => {
    const source = readPage("Agents.tsx");

    expect(source).toContain('provider_id: formData.get("provider_id") as string');
    expect(source).toContain('formData.set("provider_id", selectedProvider);');
    expect(source).not.toContain('provider: formData.get("provider") as string');
  });

  test("Chat page wires live activity timeline to SSE status events", () => {
    const source = readPage("Chat.tsx");

    expect(source).toContain('appendApiTokenParam("/api/sse/status")');
    expect(source).toContain('status === "tool_executing"');
    expect(source).toContain('status === "tool_completed"');
    expect(source).toContain("<LiveActivityTimeline");
    expect(source).toContain("status={timelineStatus}");
    expect(source).toContain("activities={liveActivities}");
    expect(source).toContain("currentStep={liveCurrentStep}");
    expect(source).toContain("formatToolIntent(");
    expect(source).toContain("Highlight, themes");
    expect(source).toContain("function looksLikeDiffCode");
    expect(source).toContain("if (looksLikeDiffCode(rawCode, language))");
    expect(source).toContain("table: ({ children }) => (");
    expect(source).toContain("th: ({ children }) => (");
    expect(source).toContain("<SyntaxCodeBlock");
    expect(source).toContain("function CopyCodeButton");
    expect(source).toContain("function InlineCodeSnippet");
    expect(source).toContain("navigator.clipboard.writeText");
    expect(source).toContain('title={copied ? "Copied" : "Copy code"}');
    expect(source).not.toContain("Copy inline code");
    expect(source).toContain('const inferredInline = !className && !rawCode.includes("\\n")');
    expect(source).toContain("pendingProcessCaptureRef");
    expect(source).toContain("buildActivitiesFromToolCalls");
    expect(source).toContain("finalizeCompletedActivities");
    expect(source).toContain("chatApi.getSessionStatus(");
    expect(source).toContain("showWorkingTimeline");
  });
});
