import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chatWorkspaceTabLabel } from "../../ui/src/pages/chat/ChatWorkspacePanel";

const chatSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url)),
  "utf8"
);
const environmentSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatEnvironmentOverview.tsx", import.meta.url)),
  "utf8"
);
const browserSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatWorkspaceBrowser.tsx", import.meta.url)),
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
const nativeChatSource = readFileSync(
  fileURLToPath(
    new URL("../../apps/macos/Cybara/Sources/Cybara/NativeScreens.swift", import.meta.url)
  ),
  "utf8"
);
const styleSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/index.css", import.meta.url)),
  "utf8"
);
const panelSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatWorkspacePanel.tsx", import.meta.url)),
  "utf8"
);

describe("chat workspace panel", () => {
  test("exposes the integrated workspace tools", () => {
    expect(chatWorkspaceTabLabel("review")).toBe("Review");
    expect(chatWorkspaceTabLabel("terminal")).toBe("Terminal");
    expect(chatWorkspaceTabLabel("browser")).toBe("Browser");
    expect(chatWorkspaceTabLabel("files")).toBe("Files");
    expect(chatWorkspaceTabLabel("subagents")).toBe("Side task");
  });

  test("reuses secured terminal, browser, IDE file, diff, and subagent surfaces", () => {
    expect(chatSource).toContain("ChatWorkspacePanel");
    expect(chatSource).toContain("EmbeddedTerminalPanel");
    expect(chatSource).toContain("ChatWorkspaceBrowser");
    expect(chatSource).toContain("ChatWorkspaceFiles");
    expect(chatSource).toContain("<SessionDiffPanel");
    expect(chatSource).toContain("<SubagentPanel");
    expect(chatSource).toContain('toggleWorkspaceTab("review")');
    expect(chatSource).toContain('toggleWorkspaceTab("subagents")');
    expect(panelSource).toContain('aria-label="Add workspace tool"');
    expect(panelSource).toContain('role="menuitem"');
  });

  test("environment preview opens active workspace tabs", () => {
    expect(environmentSource).toContain('EnvironmentSection title="Preview"');
    expect(environmentSource).toContain("onOpenWorkspaceTab(tab)");
    expect(chatSource).toContain("previewTabs={workspaceTabs.filter");
  });

  test("browser preview shares the chat session and fills the workspace panel", () => {
    expect(chatSource).toContain("sessionId={sessionId}");
    expect(chatSource).toContain('key={sessionId || "new-chat-browser"}');
    expect(browserSource).toContain("viewportWidth");
    expect(browserSource).toContain("ResizeObserver");
    expect(browserSource).toContain("refreshSessionPreview");
    expect(browserSource).toContain("const BROWSER_PREVIEW_POLL_MS = 1_500");
    expect(browserSource).toContain("const BROWSER_STATE_POLL_MS = 500");
    expect(browserSource).toContain("AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS)");
    expect(browserSource).toContain("data-browser-session-id={browserSessionId}");
    expect(browserSource).toContain("getBoundingClientRect");
    expect(browserSource).toContain("/state`");
    expect(browserSource).toContain("browser-agent-cursor");
    expect(browserSource).toContain('cursor.source !== "agent"');
    expect(browserSource).toContain("browser-agent-click");
    expect(browserSource).toContain('aria-label="Interactive browser preview"');
    expect(browserSource).toContain("const BROWSER_START_TIMEOUT_MS = 90_000");
    expect(browserSource).toContain('apiFetch("/api/browser/status"');
    expect(browserSource).toContain("browserStartupLabel(status)");
    expect(browserSource).toContain('sendPageInput("pointer/click"');
    expect(browserSource).toContain('sendPageInput("scroll"');
    expect(browserSource).toContain('sendPageInput("keyboard"');
    expect(browserSource).toContain("transition-[left,top] duration-100");
    expect(browserSource).not.toContain(">\n              Agent\n");
    expect(browserSource).toContain("absolute inset-0 h-full w-full");
    expect(browserSource).not.toContain("Close browser tab");
    expect(chatSource).toContain("onTitleChange={setWorkspaceBrowserTitle}");
    expect(browserManagerSource).toContain('button[aria-label^="Cybara pet"]');
    expect(nativeBrowserSource).toContain(
      ".animation(.easeOut(duration: 0.5), value: cursor.updatedAt ?? 0)"
    );
    expect(styleSource).toContain("animation: browser-agent-click-pulse 420ms ease-out forwards");
  });

  test("workspace tools remain mounted while switching tabs", () => {
    expect(chatSource).toContain('workspaceTabs.includes("terminal")');
    expect(chatSource).toContain('activeWorkspaceTab !== "terminal" && "hidden"');
    expect(chatSource).toContain(
      'visible={showWorkspacePanel && activeWorkspaceTab === "terminal"}'
    );
    expect(chatSource).toContain('workspaceTabs.includes("browser")');
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
    expect(nativeChatSource).not.toContain("switch activeWorkspaceTab");
  });

  test("composer selectors suppress native focus chrome", () => {
    expect(styleSource).toContain(".chat-approval-toggle:focus-visible");
    expect(styleSource).toContain(".chat-agent-selector:focus-visible");
    expect(styleSource).toContain("background: transparent");
    expect(styleSource).toContain("box-shadow: none");
  });
});
