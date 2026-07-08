import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pagesDir = fileURLToPath(new URL("../../ui/src/pages", import.meta.url));
const libDir = fileURLToPath(new URL("../../ui/src/lib", import.meta.url));
const uiDir = fileURLToPath(new URL("../../ui/src", import.meta.url));

function readPage(fileName: string): string {
  return readFileSync(join(pagesDir, fileName), "utf8");
}

function readLib(fileName: string): string {
  return readFileSync(join(libDir, fileName), "utf8");
}

function readUiSource(fileName: string): string {
  return readFileSync(join(uiDir, fileName), "utf8");
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

  test("Mobile page manages device pairing through mobile hooks", () => {
    const source = readPage("Mobile.tsx");

    expect(source).toContain("useMobileConnectInfo");
    expect(source).toContain("useMobileDevices");
    expect(source).toContain("useCreateMobilePairingCode");
    expect(source).toContain("useRevokeMobileDevice");
    expect(source).toContain("useDeleteMobileDevice");
    expect(source).toContain("pairing.qrDataUrl");
    expect(source).toContain("pairing.code");
    expect(source).toContain("setRevokeTarget(device)");
    expect(source).toContain("setDeleteTarget(device)");
    expect(source).toContain("Detected URLs");
    expect(source).toContain("canCreatePairing");
    expect(source).toContain("connectInfo?.lanAccessEnabled");
    expect(source).toContain("connectInfo?.remoteAccess?.ready");
    expect(source).toContain("Network access is required");
    expect(source).toContain("disabled={!canCreatePairing}");
    expect(source).not.toContain("Physical Phone Check");
    expect(source).toContain("device.push?.configured");
    expect(source).toContain("Notifications:");
    expect(source).not.toContain("apiFetch(");
    expect(source).not.toContain("window.fetch(");
    expect(source).not.toContain("globalThis.fetch(");
  });

  test("Settings feature toggle uses settingsApi and restores state on update failure", () => {
    const source =
      readPage("Settings.tsx") +
      readUiSource("components/settings/GatewayPathSettingsSection.tsx") +
      readUiSource("components/settings/GatewayRemoteAccessSection.tsx");

    expect(source).toMatch(/import\s*\{[^}]*\bsettingsApi\b[^}]*\}\s*from\s*['"]@\/lib\/api['"]/);
    expect(source).toContain("settingsApi.getConfig()");
    expect(source).toContain("settingsApi.updateConfig({ terminal_enabled: enabled })");
    expect(source).toContain("settingsApi.updateConfig({ dangerous_tool_policy: next })");
    expect(source).toContain("settingsApi.updateConfig({ tool_approval_mode: nextMode })");
    expect(source).toContain("function SpeechSettingsSection()");
    expect(source).toContain("setGatewayAccessPassword(password)");
    expect(source).toContain("clearGatewayAccessPassword()");
    expect(source).toContain("gatewayPasswordEnabled");
    expect(source).toContain("Listen on local network");
    expect(source).toContain('enabled ? "0.0.0.0" : "127.0.0.1"');
    expect(source).toContain("authApi.updateSettings({ host, applyHostNow: true })");
    expect(source).toContain("expectedRuntimeHost(latest.host)");
    expect(source).toContain("Failed to confirm gateway listener");
    expect(source).toContain("res.data.gatewayFirewall");
    expect(source).toContain("settings?.gatewayFirewall?.required");
    expect(source).toContain("LAN access enabled and Windows Firewall allows the gateway");
    expect(source).toContain("GatewayRemoteAccessSection");
    expect(source).toContain("remoteAccess");
    expect(source).not.toContain("Boolean(settings?.hostForced) || applyingHost");
    expect(source).toContain("settingsApi.updateConfig({ speech })");
    expect(source).toContain("settingsApi.updateConfig({");
    expect(source).toContain("computer_use: { driverCommand: trimmed }");
    expect(source).toContain("export function GatewayPathSettingsSection");
    expect(source).toContain("default_workspace_dir: defaultWorkspaceDir.trim()");
    expect(source).toContain("cybara_data_dir: cybaraDataDirDraft.trim()");
    expect(source).toContain("<GatewayPathSettingsSection infoData={infoData} />");
    expect(source).toContain("Data Directory");
    expect(source).toContain("configured_cybara_data_dir");
    expect(source).toContain("Restart required");
    expect(source).toContain("openDesktopDirectoryDialog({");
    expect(source).toContain("function ComputerUseSettings()");
    expect(source).toContain("function MigrationSettingsSection()");
    expect(source).toContain("migrationApi.sources()");
    expect(source).toContain("migrationApi.preview(payload())");
    expect(source).toContain("migrationApi.run(payload())");
    expect(source).toContain('useState<MigrationSourceKind>("openclaw")');
    expect(source).toContain("openDesktopFileDialog");
    expect(source).toContain("openDesktopDirectoryDialog");
    expect(source).toContain("Driver path override");
    expect(source).toContain("ElevenLabs");
    expect(source).toContain("Native dictation only");
    expect(source).toContain("gpt-4o-mini-transcribe");
    expect(source).toContain("setTerminalEnabled(enabled);");
    expect(source).toContain("setTerminalEnabled(!enabled);");
    expect(source).not.toContain("apiFetch(");
  });

  test("Web and Tauri theme accents sync through gateway config", () => {
    const settingsSource = readPage("Settings.tsx");
    const appSource = readUiSource("App.tsx");
    const storeSource = readUiSource("stores/uiStore.ts");

    expect(settingsSource).toContain("settingsApi.updateConfig(themeConfigPayload(key))");
    expect(settingsSource).toContain("readThemeAccentFromConfig(result.data)");
    expect(appSource).toContain("function ThemeConfigSync()");
    expect(appSource).toContain("settingsApi.getConfig()");
    expect(appSource).toMatch(/window\.addEventListener\(["']focus["'],\s*syncTheme\)/);
    expect(storeSource).toContain("export function themeConfigPayload");
    expect(storeSource).toContain("config?.theme,");
  });

  test("Setup page completes onboarding through setupApi helper", () => {
    const source = readPage("Setup.tsx");

    expect(source).toMatch(
      /type SetupAuthFlow = ["']api_key["'] \| ["']oauth["'] \| ["']external["'] \| ["']none["'];/
    );
    expect(source).toMatch(/if \(provider\.authType === ["']oauth["']\) return ["']oauth["'];/);
    expect(source).toMatch(
      /if \(provider\.authType === ["']aws-sdk["']\) return ["']external["'];/
    );
    expect(source).not.toContain(
      "provider.authType === 'oauth' || provider.authType === 'aws-sdk'"
    );
    expect(source).toMatch(/authFlow === ["']external["']/);
    expect(source).toContain("External");
    expect(source).toMatch(
      /import\s*\{\s*setupApi,\s*settingsApi\s*\}\s*from\s*["']@\/lib\/api["'];/
    );
    expect(source).toContain("setupApi.complete()");
    expect(source).toContain("settingsApi.updateConfig({ tool_approval_mode: toolApprovalMode })");
    expect(source).not.toContain("apiFetch('/api/setup/complete'");
  });

  test("Providers page keeps OAuth flows on expected backend routes", () => {
    const source = readPage("Providers.tsx");
    const typesSource = readFileSync(
      new URL("../../ui/src/types/index.ts", import.meta.url),
      "utf8"
    );

    expect(typesSource).toContain("export type ProviderAuthType");
    expect(typesSource).toContain('"none" | "api_key" | "bearer" | "token" | "oauth" | "aws-sdk"');
    expect(typesSource).toContain("authType?: ProviderAuthType;");
    expect(source).toMatch(/apiFetch\(["']\/api\/providers\/oauth\/device-code["']/);
    expect(source).toMatch(/apiFetch\(["']\/api\/providers\/oauth\/poll["']/);
    expect(source).toMatch(/apiFetch\(["']\/api\/providers\/oauth\/start["']/);
    expect(source).toMatch(/apiFetch\(["']\/api\/providers\/oauth\/callback-status["']/);
    expect(source).toContain("apiFetch(`/api/providers/${provider.id}/test`");
    expect(source).toContain("openExternal(data.verification_uri)");
    expect(source).toContain("openExternal(data.auth_url)");
    expect(source).toMatch(
      /const authType = selectedProviderInfo\?\.authType \|\| ["']api_key["'];/
    );
    expect(source).toMatch(/authType === ["']api_key["']/);
    expect(source).toMatch(/authType === ["']oauth["']/);
    expect(source).toMatch(/authType === ["']aws-sdk["']/);
    expect(source).toMatch(/authType === ["']none["']/);
  });

  test("IDE page routes file and git operations through encoded API paths", () => {
    // The file-tree browse fetch was extracted into ide/FileTree.tsx.
    const ideSource = readPage("IDE.tsx") + readPage("ide/FileTree.tsx");
    const codeViewerSource = readPage("ide/CodeViewer.tsx");
    const createDialogSource = readPage("ide/CreateDialog.tsx");
    const gitStatusSource = readPage("ide/GitStatus.tsx");

    expect(ideSource).toContain("apiFetch(`/api/ide/browse?path=${encodeURIComponent(path)}`)");
    expect(codeViewerSource).toContain("apiFetch(`/api/ide/read?path=${encodeURIComponent(path)}`");
    expect(codeViewerSource).toContain('apiFetch("/api/ide/write",');
    expect(codeViewerSource).toContain("apiFetch(`/api/git/diff?path=${encodeURIComponent(path)}`");
    expect(createDialogSource).toContain('apiFetch("/api/ide/create",');
    expect(codeViewerSource).toContain(
      "apiFetch(`/api/lsp/diagnostics/file?path=${encodeURIComponent(path)}`)"
    );
    expect(gitStatusSource).toContain(
      "apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`,"
    );
  });

  test("IDE page includes quick navigation controls for filtering and line jump", () => {
    const ideSource = readPage("IDE.tsx");
    const codeViewerSource = readPage("ide/CodeViewer.tsx");

    expect(ideSource).toContain('placeholder="Filter files"');
    expect(ideSource).toContain('setTreeFilter("")');
    expect(ideSource).toContain("jumpToLineRequest={requestedJumpLine}");
    expect(codeViewerSource).toContain("const promptJumpToLine = useCallback(");
    expect(codeViewerSource).toContain('e.key.toLowerCase() === "g"');
    expect(codeViewerSource).toContain("data-line-number={i + 1}");
  });

  test("Terminal page uses token-aware websocket URL helper", () => {
    const source = readPage("Terminal.tsx");

    expect(source).toContain("import { checkTerminalAccess, enableTerminalAccess }");
    expect(source).toContain("void refreshTerminalAccess()");
    expect(source).toContain("await enableTerminalAccess()");
    expect(source).toContain(
      "appendApiTokenParam(`/api/terminal/ws?session=${encodeURIComponent(id)}`)"
    );
    expect(source).toContain("new WebSocket(`${proto}//${window.location.host}${wsPath}`)");
    expect(source).toContain("Enable Web Terminal");
    expect(source).toContain("/settings?section=safety");
  });

  test("Embedded IDE terminal uses the shared terminal access helper", () => {
    const source = readFileSync(
      new URL("../../ui/src/components/ide/EmbeddedTerminalPanel.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("import { checkTerminalAccess, enableTerminalAccess }");
    expect(source).toContain("const access = await checkTerminalAccess()");
    expect(source).toContain("await enableTerminalAccess()");
    expect(source).toContain("Enable Web Terminal");
  });

  test("Tasks page loads run history through tasksApi helper", () => {
    const source = readPage("Tasks.tsx");

    expect(source).toMatch(/import\s*\{\s*tasksApi\s*\}\s*from\s*["']@\/lib\/api["'];/);
    expect(source).toContain("tasksApi.getRuns(expandedTaskId)");
    expect(source).not.toContain("apiFetch(`/api/tasks/${expandedTaskId}/runs`)");
  });

  test("Memory page creates files through memoryApi helper", () => {
    const source = readPage("Memory.tsx");

    expect(source).toMatch(/import\s*\{[^}]*\bmemoryApi\b[^}]*\}\s*from\s*['"]@\/lib\/api['"]/);
    expect(source).toContain("useUpdateMemory");
    expect(source).toContain("useDeleteMemory");
    expect(source).toContain("memoryApi.createFile(file, content)");
    expect(source).toContain("updateMemory.mutateAsync({ file, index, content })");
    expect(source).toContain("deleteMemory.mutateAsync({");
    expect(source).toContain("file: deletingEntry.file");
    expect(source).toContain("index: deletingEntry.index");
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

    expect(logsSource).toMatch(/import\s*\{\s*logsApi\s*\}\s*from\s*["']@\/lib\/api["'];/);
    expect(logsSource).toContain("logsApi.getPage(LOGS_PAGE_SIZE, 0)");
    expect(logsSource).toContain("logsApi.getPage(LOGS_PAGE_SIZE, logs.length)");
    expect(logsSource).toContain("logsApi.getStats(24)");
    expect(logsSource).toContain("logsApi.search(searchQuery)");
    expect(logsSource).toContain("Unified log stream");
    expect(logsSource).toContain("liveEnabled");
    expect(logsSource).toContain("Pause");
    expect(logsSource).toContain("gateway/app");
    expect(logsSource).toContain("LogsSkeleton");
    expect(logsSource).not.toContain("apiFetch(");

    expect(sessionsSource).toMatch(/import\s*\{\s*sessionsApi\s*\}\s*from\s*["']@\/lib\/api["'];/);
    expect(sessionsSource).toContain("sessionsApi.list({ limit: targetLimit, offset: 0 })");
    expect(sessionsSource).toContain("sessionsApi.list({");
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
    expect(source).toContain("confirm(`Install ${server.name}?");
    expect(source).toContain("mcpApi.install({ id: server.id, trustedAction: true })");
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
    expect(source).toContain("walletApi.priceQuote(");
    expect(source).toContain("walletApi.accounts(");
    expect(source).toContain("walletApi.balances(");
    expect(source).toContain("walletApi.tokenBalances(");
    expect(source).toContain("walletApi.tokenTransactions(");
    expect(source).toContain("walletApi.transactions(");
    expect(source).toContain("walletApi.send(");
    expect(source).toContain("walletApi.sendToken(");
    expect(source).toContain("WALLET_TABS");
    expect(source).not.toContain("globalThis.confirm");
    expect(source).not.toContain("globalThis.prompt");
    expect(source).not.toContain("apiFetch(");
  });

  test("Wallet management (RPC, policy, delete) lives in Settings", () => {
    const source = readPage("Settings.tsx");

    expect(source).toContain("walletApi.rpc()");
    expect(source).toContain("walletApi.rpcStatus()");
    expect(source).toContain("walletApi.getAgentPolicy()");
    expect(source).toContain("walletApi.setAgentAccess(");
    expect(source).toContain("walletApi.updateAgentPolicy(");
    expect(source).toContain("walletApi.updateRpc(");
    expect(source).toContain("walletApi.deleteWallet(");
    expect(source).toContain('Type "DELETE" to confirm');
  });

  test("Wallet send requires a confirmation step before moving funds", () => {
    const source = readPage("Wallet.tsx");
    // handleSend must not call the send APIs directly — it opens a confirm dialog,
    // and only executeSend (run on confirm) performs the transfer.
    expect(source).toContain("setSendConfirmOpen(true)");
    expect(source).toContain("async function executeSend()");
    expect(source).toContain("onConfirm={() => void executeSend()}");
    expect(source).toContain("isOpen={sendConfirmOpen}");
    // The dialog spells out that the transfer is irreversible.
    expect(source).toContain("cannot be undone");
    // The Send button opens the flow via handleSend, not executeSend directly.
    expect(source).toContain("onClick={() => void handleSend()}");
  });

  test("Agents page sends provider_id in create/update payloads", () => {
    const source = readPage("Agents.tsx");

    expect(source).toContain('provider_id: formData.get("provider_id") as string');
    expect(source).toContain('formData.set("provider_id", selectedProvider);');
    expect(source).not.toContain('provider: formData.get("provider") as string');
  });

  test("Chat page wires live activity timeline to websocket status events", () => {
    // Chat page logic is split across the page + its extracted chat/ modules.
    const source =
      readPage("Chat.tsx") + readPage("chat/chatModel.ts") + readPage("chat/MessageContent.tsx");
    const statusStreamSource = readLib("status-stream.ts");

    expect(source).toContain("connectStatusStream({");
    expect(statusStreamSource).toContain('new WebSocket(toWebSocketUrl("/api/ws/status"))');
    expect(statusStreamSource).toContain("appendApiTokenParam(path)");
    expect(source).toContain('status === "tool_executing"');
    expect(source).toContain('status === "tool_completed"');
    expect(source).toContain("<LiveActivityTimeline");
    expect(source).toContain("status={timelineStatus}");
    expect(source).toContain("activities={timelineActivities}");
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
