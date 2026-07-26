import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chatWorkspaceTabLabel } from "../../ui/src/pages/chat/ChatWorkspacePanel";
import { readNativeChatSource, readUiStylesSource } from "../shared/source-bundles";

const chatSource = [
  "../../ui/src/pages/Chat.tsx",
  "../../ui/src/pages/chat/ChatWorkspaceDock.tsx",
  "../../ui/src/pages/chat/ChatPageHeader.tsx",
  "../../ui/src/pages/chat/useChatWorkspaceTabs.ts",
]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");
const environmentSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatEnvironmentOverview.tsx", import.meta.url)),
  "utf8"
);
const browserSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatWorkspaceBrowser.tsx", import.meta.url)),
  "utf8"
);
const browserImageSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/BrowserPreviewImage.tsx", import.meta.url)),
  "utf8"
);
const browserStreamClientSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/browserPreviewStreamClient.ts", import.meta.url)),
  "utf8"
);
const computerSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatWorkspaceComputer.tsx", import.meta.url)),
  "utf8"
);
const browserManagerSource = readFileSync(
  fileURLToPath(new URL("../../src/core/browser/pw-manager.ts", import.meta.url)),
  "utf8"
);
const nativeBrowserSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../apps/macos/Cybara/Sources/Cybara/NativeChatWorkspacePanel.swift",
      import.meta.url
    )
  ),
  "utf8"
);
const nativeChatSource = readNativeChatSource();
const styleSource = readUiStylesSource();
const panelSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatWorkspacePanel.tsx", import.meta.url)),
  "utf8"
);
const filesSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatWorkspaceFiles.tsx", import.meta.url)),
  "utf8"
);

describe("chat workspace panel", () => {
  test("exposes the integrated workspace tools", () => {
    expect(chatWorkspaceTabLabel("review")).toBe("Review");
    expect(chatWorkspaceTabLabel("terminal")).toBe("Terminal");
    expect(chatWorkspaceTabLabel("browser")).toBe("Browser");
    expect(chatWorkspaceTabLabel("computer")).toBe("Desktop");
    expect(chatWorkspaceTabLabel("files")).toBe("Files");
    expect(chatWorkspaceTabLabel("subagents")).toBe("Side task");
  });

  test("reuses secured terminal, browser, IDE file, diff, and subagent surfaces", () => {
    expect(chatSource).toContain("ChatWorkspacePanel");
    expect(chatSource).toContain("EmbeddedTerminalPanel");
    expect(chatSource).toContain("ChatWorkspaceBrowser");
    expect(chatSource).toContain("ChatWorkspaceComputer");
    expect(chatSource).toContain("ChatWorkspaceSimulator");
    expect(chatSource).toContain("ChatWorkspaceFiles");
    expect(chatSource).toContain("onOpenDiffInWorkspace");
    expect(chatSource).toContain("openWorkspaceFile");
    expect(chatSource).toContain("<SessionDiffPanel");
    expect(chatSource).toContain("<SubagentPanel");
    expect(chatSource).toContain("<SubagentDetailPanel");
    expect(chatSource).toContain("openSubagent");
    expect(chatSource).toContain("onOpenSubagent");
    expect(chatSource).toContain('toggleWorkspaceTab("review")');
    expect(chatSource).toContain('toggleWorkspaceTab("subagents")');
    expect(panelSource).toContain('aria-label="Add workspace tool"');
    expect(panelSource).toContain('role="menuitem"');
  });

  test("integrates file editing, saving, diagnostics, and full IDE expansion", () => {
    expect(filesSource).toContain('apiFetch("/api/ide/write"');
    expect(filesSource).toContain("/api/lsp/diagnostics/file?");
    expect(filesSource).toContain("<LSPStatus");
    expect(filesSource).toContain("compact");
    expect(filesSource).toContain('aria-label="Workspace file editor"');
    expect(filesSource).toContain("onOpenFullIde(selectedPath)");
  });

  test("environment preview opens active workspace tabs", () => {
    expect(environmentSource).toContain('EnvironmentSection title="Preview"');
    expect(environmentSource).toContain("onOpenWorkspaceTab(tab)");
    expect(chatSource).toContain("previewTabs: Array.from(");
  });

  test("browser preview shares the chat session and fills the workspace panel", () => {
    expect(chatSource).toContain("sessionId={sessionId}");
    expect(chatSource).toContain('key={`${instance.id}:${sessionId || "new-chat"}`}');
    expect(chatSource).toContain("pageKey={instance.pageKey}");
    expect(browserSource).toContain("viewportWidth");
    expect(browserSource).toContain("ResizeObserver");
    expect(browserSource).not.toContain("refreshSessionPreview");
    expect(browserSource).toContain("browserPreviewPollDelay");
    expect(browserSource).toContain("connectStatusStream");
    expect(browserSource).toContain('event.toolName !== "browser"');
    expect(browserSource).toContain("pendingPageRef");
    expect(browserSource).toContain("pending?.sessionId === browserSessionId");
    expect(browserSource).toContain("if (queuedFreshPageRef.current) return;");
    expect(browserSource).toContain("if (!target) return;");
    expect(browserSource).not.toContain("if (!target || loading) return;");
    expect(browserSource).toContain("const BROWSER_PREVIEW_QUALITY = 78");
    expect(browserSource).not.toContain("BROWSER_STATE_POLL_MS");
    expect(browserSource).toContain('format: "jpeg"');
    expect(browserSource).toContain('document.visibilityState === "visible"');
    expect(browserSource).toContain("onTitleChangeRef.current");
    expect(browserSource).toContain("AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS)");
    expect(browserSource).toContain("data-browser-session-id={browserSessionId}");
    expect(browserSource).toContain("getBoundingClientRect");
    expect(browserSource).not.toContain("/state?includePage=false");
    expect(browserSource).toContain("BrowserScrollBatcher");
    expect(browserSource).toContain("BrowserFramePresenter");
    expect(browserSource).toContain("decodeBrowserPreviewImage");
    expect(browserSource).toContain("schedulePreviewRefresh");
    expect(browserSource).toContain("normalizeBrowserWheelDelta");
    expect(browserImageSource).toContain('decoding="async"');
    expect(browserImageSource).toContain("createHydratedAuthenticatedWebSocket");
    expect(browserImageSource).toContain("LatestBrowserFrameDecoder");
    expect(browserImageSource).toContain("image.src = source");
    expect(browserImageSource).toContain("window.createImageBitmap(frame)");
    expect(browserImageSource).toContain(
      'canvas.getContext("2d", { alpha: false, desynchronized: true })'
    );
    expect(browserImageSource).toContain("context?.drawImage");
    expect(browserImageSource).not.toContain("setStreamSource");
    expect(browserImageSource).toContain("framePresentedRef.current(false)");
    expect(browserStreamClientSource).toContain("class LatestBrowserFrameDecoder");
    expect(browserImageSource).toContain("everyNthFrame");
    expect(browserSource).toContain("streamConnectedRef.current");
    expect(browserSource).toContain("streamInputRef.current?.(input)");
    expect(browserSource).toContain("loadBrowserState");
    expect(browserSource).toContain('query.set("revision", previewRevisionRef.current)');
    expect(browserSource).toContain('aria-label="Open in system browser"');
    expect(chatSource).toContain("openWorkspaceBrowser(route.url)");
    expect(chatSource).toContain("navigationRequest={instance.navigationRequest}");
    expect(chatSource).toContain("navigationUrl={instance.navigationUrl}");
    expect(browserSource).toContain("browser-agent-cursor");
    expect(browserSource).toContain('cursor.source !== "agent"');
    expect(browserSource).toContain("browser-agent-click");
    expect(browserSource).toContain('aria-label="Interactive browser preview"');
    expect(browserSource).toContain(
      'addEventListener("wheel", handlePreviewWheel, { passive: false })'
    );
    expect(browserSource).toContain("event.stopPropagation()");
    expect(browserSource).not.toContain("onWheel={handlePreviewWheel}");
    expect(browserSource).toContain("overscroll-contain");
    expect(browserImageSource).toContain('canvas.style.visibility = "hidden"');
    expect(browserImageSource).toContain("if (!hasStreamFrame)");
    expect(browserSource).toContain("const BROWSER_START_TIMEOUT_MS = 90_000");
    expect(browserSource).toContain('apiFetch("/api/browser/status"');
    expect(browserSource).toContain("browserStartupLabel(status)");
    expect(browserSource).toContain('sendPageInput(page, { type: "pointer_click"');
    expect(browserSource).toContain('sendPageInput(page, { type: "scroll"');
    expect(browserSource).toContain('sendPageInput(page, { type: "keyboard"');
    expect(browserSource).toContain("transition-[left,top] duration-150");
    expect(browserSource).not.toContain(">\n              Agent\n");
    expect(browserImageSource).toContain("absolute inset-0 h-full w-full");
    expect(browserImageSource).toContain("object-contain");
    expect(browserImageSource).not.toContain("object-fill");
    expect(browserSource).not.toContain("Close browser tab");
    expect(chatSource).toContain("onTitleChange={(title) => onUpdateTabTitle(instance.id, title)}");
    expect(browserManagerSource).toContain('button[aria-label^="Cybara pet"]');
    expect(nativeBrowserSource).toContain(
      "@Environment(\\.accessibilityReduceMotion) private var systemReduceMotion"
    );
    expect(nativeBrowserSource).toContain(
      ".animation(systemReduceMotion ? nil : .easeOut(duration: 0.15), value: cursor.updatedAt ?? 0)"
    );
    expect(nativeBrowserSource).toContain("@FocusState private var addressFocused: Bool");
    expect(nativeBrowserSource).toContain("guard isActive else { return }");
    expect(nativeBrowserSource).toContain("if !addressFocused {");
    expect(nativeBrowserSource).toContain("revision: revision");
    expect(nativeBrowserSource).toContain('URLQueryItem(name: "revision", value: revision)');
    expect(nativeBrowserSource).toContain('URLQueryItem(name: "viewportWidth", value: "960")');
    expect(nativeBrowserSource).toContain("if let nextImage = preview.image {");
    expect(nativeBrowserSource).toContain(".scaledToFit()");
    expect(nativeBrowserSource).not.toContain(".scaledToFill()");
    expect(styleSource).toContain("animation: browser-agent-click-pulse 420ms ease-out forwards");
  });

  test("simulator preview follows agent activity without aggressive idle polling", () => {
    expect(chatSource).toContain("sessionId={sessionId}");
    const simulatorSource = readFileSync(
      fileURLToPath(new URL("../../ui/src/pages/chat/ChatWorkspaceSimulator.tsx", import.meta.url)),
      "utf8"
    );
    expect(simulatorSource).toContain("connectStatusStream");
    expect(simulatorSource).toContain('event.toolName !== "mobile_simulator"');
    expect(simulatorSource).toContain("simulatorPreviewPollDelay");
    expect(simulatorSource).toContain('data-testid="simulator-agent-cursor"');
    expect(simulatorSource).toContain('label="Home"');
    expect(simulatorSource).toContain('label="Save screenshot"');
    expect(simulatorSource).toContain('key: "RECENTS"');
    expect(simulatorSource).toContain("deviceId: selectedId, sessionId");
    expect(simulatorSource).toContain('apiFetch("/api/simulators/ios/automation/install"');
    expect(simulatorSource).toContain("Installing direct iOS controls");
    expect(simulatorSource).not.toContain("FRAME_POLL_MS");
  });

  test("computer use has a session-scoped visual preview with agent cursor telemetry", () => {
    expect(computerSource).toContain("/api/computer-use/preview?");
    expect(computerSource).toContain("screenshotRevision");
    expect(computerSource).toContain('data-testid="computer-agent-cursor"');
    expect(computerSource).toContain("COMPUTER_PREVIEW_POLL_MS = 300");
    expect(nativeBrowserSource).toContain("NativeChatComputerPanel");
    expect(nativeChatSource).toContain("activeWorkspaceTab == .computer");
  });

  test("workspace tools remain mounted while switching tabs", () => {
    expect(chatSource).toContain("tabs.map((instance)");
    expect(chatSource).toContain('instance.kind === "terminal"');
    expect(chatSource).toContain('cn("h-full", !active && "hidden")');
    expect(chatSource).toContain("visible={isOpen && active}");
    expect(chatSource).toContain('instance.kind === "browser"');
  });

  test("keeps a visible workspace panel on a valid active tab after chat switches", () => {
    expect(chatSource).toContain(
      "if (tabs.some((instance) => instance.id === activeTabId)) return;"
    );
    expect(chatSource).toContain("selectTab(tabs[0].id)");
  });

  test("browser and terminal support multiple instances in the workspace panel", () => {
    expect(panelSource).toContain("WorkspaceTabInstance");
    expect(panelSource).toContain("WORKSPACE_SINGLETON_KINDS");
    expect(chatSource).toContain("tabIdRef");
    expect(chatSource).toContain('kind === "browser"');
    expect(chatSource).toContain('tabs.some((instance) => instance.kind === "browser")');
  });

  test("opens each subagent run in a durable workspace tab", () => {
    expect(chatSource).toContain(
      'instance.kind === "subagents" && instance.pageKey === normalizedRunId'
    );
    expect(chatSource).toContain("id = `subagent-${(tabIdRef.current += 1)}`");
    expect(chatSource).toContain("runId={instance.pageKey}");
    expect(chatSource).toContain("previousSessionIdRef.current === sessionId");
    expect(chatSource).toContain('instance.kind === "subagents" && instance.pageKey');
  });

  test("workspace tools remain mounted when the panel is hidden", () => {
    expect(panelSource).not.toContain("if (!isOpen) return null");
    expect(panelSource).toContain("aria-hidden={!isOpen}");
    expect(panelSource).toContain('isOpen ? "flex" : "hidden"');
  });

  test("native workspace tools remain mounted while switching tabs", () => {
    expect(nativeChatSource).toContain("ZStack {");
    expect(nativeChatSource).toContain(
      ".nativeWorkspacePanelVisibility(activeWorkspaceTab == .terminal)"
    );
    expect(nativeChatSource).toContain("isActive: activeWorkspaceTab == .browser");
    expect(nativeChatSource).toContain("isActive: activeWorkspaceTab == .terminal");
    expect(nativeChatSource).not.toContain("switch activeWorkspaceTab");
  });

  test("composer selectors suppress native focus chrome", () => {
    expect(styleSource).toContain(".chat-approval-toggle:focus-visible");
    expect(styleSource).toContain(".chat-agent-selector:focus-visible");
    expect(styleSource).toContain("background: transparent");
    expect(styleSource).toContain("box-shadow: none");
  });
});
