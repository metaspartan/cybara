import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("multi-chat workspace wiring", () => {
  test("routes multi-chat URLs to a lazy workspace", () => {
    const source = readSource("ui/src/App.tsx");

    expect(source).toContain("const MultiChatWorkspace = lazy");
    expect(source).toContain("isMultiChatSearch(location.search)");
    expect(source).toContain('return <MultiChatWorkspace key="multi-chat" />');
  });

  test("opens multi-chat from the chat header and main sidebar", () => {
    const chat = readSource("ui/src/pages/Chat.tsx");
    const header = readSource("ui/src/pages/chat/ChatPageHeader.tsx");
    const sidebar = readSource("ui/src/components/layout/Sidebar.tsx");

    expect(chat).toContain("navigate(buildMultiChatPath([sessionId]))");
    expect(header).toContain('aria-label="Open multi-chat"');
    expect(sidebar).toContain("buildMultiChatPath(currentSessionId ? [currentSessionId] : [])");
    expect(sidebar).toContain("multiChatActive");
  });

  test("supports searchable selection and sidebar drag and drop", () => {
    const workspace = readSource("ui/src/pages/chat/MultiChatWorkspace.tsx");
    const dropTarget = readSource("ui/src/pages/chat/useMultiChatDropTarget.ts");
    const sidebar = readSource("ui/src/pages/chat/SessionSidebar.tsx");

    expect(workspace).toContain('aria-label="Search chats to add"');
    expect(workspace).toContain('data-testid="multi-chat-picker"');
    expect(workspace).toContain("onTargetChange: onDropTargetChange");
    expect(workspace).toContain("Drop chat here");
    expect(workspace).toContain("data-drop-active={dropTarget.active}");
    expect(workspace).toContain("activeDropIndex === index");
    expect(workspace).toContain('window.addEventListener("dragend", clearDropTarget, true)');
    expect(dropTarget).toContain("event.dataTransfer.getData(MULTI_CHAT_DRAG_TYPE)");
    expect(dropTarget).toContain("onTargetChange(index, true)");
    expect(dropTarget).toContain("event.currentTarget.contains(nextTarget)");
    expect(dropTarget).toContain('event.dataTransfer.dropEffect = "move"');
    expect(sidebar).toContain("event.dataTransfer.setData(MULTI_CHAT_DRAG_TYPE, session.id)");
    expect(sidebar).toContain("draggable");
  });

  test("shares status streaming, bounds rendering, and queues active follow-ups", () => {
    const workspace = readSource("ui/src/pages/chat/MultiChatWorkspace.tsx");
    const liveStatuses = readSource("ui/src/pages/chat/useMultiChatLiveStatuses.ts");

    expect(workspace).toContain("useMultiChatLiveStatuses");
    expect(liveStatuses).toContain("const response = await chatApi.getSessionStatus()");
    expect(liveStatuses).toContain("replayBufferedSessionEvents: true");
    expect(liveStatuses).toContain("projectMultiChatSnapshot");
    expect(liveStatuses).toContain("projectMultiChatStatusEvent");
    expect(workspace).toContain("MULTI_CHAT_RENDERED_MESSAGE_LIMIT = 80");
    expect(workspace).toContain("MULTI_CHAT_REFRESH_THROTTLE_MS = 750");
    expect(workspace).toContain('queueMode: isActive ? "queue" : undefined');
    expect(workspace).toContain("(!isActive && responsePending)");
    expect(workspace).toContain("useSessionDetail(sessionId, !isDraft)");
    expect(workspace).toContain("liveActivities={status?.activities || []}");
    expect(workspace).toContain("showWorkingTimeline={isActive}");
  });

  test("uses true desktop quadrants and stacked responsive panes", () => {
    const workspace = readSource("ui/src/pages/chat/MultiChatWorkspace.tsx");

    expect(workspace).toContain("grid-cols-1 lg:grid-cols-2");
    expect(workspace).toContain("lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(workspace).toContain("lg:min-h-0");
    expect(workspace).toContain("lg:overflow-hidden");
  });

  test("uses the shared composer controls and persists new draft chats", () => {
    const workspace = readSource("ui/src/pages/chat/MultiChatWorkspace.tsx");
    const agentControls = readSource("ui/src/pages/chat/ChatAgentControls.tsx");
    const attachments = readSource("ui/src/pages/chat/ChatComposerAttachments.tsx");

    expect(workspace).toContain("<ChatAgentControls");
    expect(workspace).toContain("<ChatReasoningControl");
    expect(workspace).toMatch(/selectedAgent\?\.provider_type\s*\?\?\s*selectedAgent\?\.provider/);
    expect(workspace).toContain("mode={selectedAgent?.reasoning_mode}");
    expect(workspace).toContain("supportedEfforts={selectedAgent?.reasoning_efforts}");
    expect(workspace).toContain("createMultiChatDraftId()");
    expect(workspace).toContain("onReplaceSession(sessionId, resolvedSessionId)");
    expect(workspace).toContain("controlId={`multi-chat-agent-selector-${index}`}");
    expect(workspace).toContain("<ChatApprovalControls");
    expect(workspace).toContain("<ChatComposerAttachments");
    expect(workspace).toContain("useChatAttachments()");
    expect(workspace).toContain("useChatDictation(setDraft)");
    expect(workspace).toContain("images: attachments.images");
    expect(workspace).toContain('data-chat-composer-input="true"');
    expect(attachments).toContain("onAddAttachmentFiles");
    expect(agentControls).toContain('controlId = "chat-agent-selector"');
    expect(agentControls).toContain("id={controlId}");
  });

  test("opens environment panels independently or together without shadows", () => {
    const workspace = readSource("ui/src/pages/chat/MultiChatWorkspace.tsx");
    const paneEnvironment = readSource("ui/src/pages/chat/MultiChatPaneEnvironment.tsx");
    const environment = readSource("ui/src/pages/chat/ChatEnvironmentOverview.tsx");

    expect(workspace).toContain("openEnvironmentIds");
    expect(workspace).toContain("toggleAllEnvironments");
    expect(workspace).toContain("<MultiChatPaneEnvironment");
    expect(workspace).toContain("aria-expanded={environmentOpen}");
    expect(paneEnvironment).not.toContain("shadow-");
    expect(paneEnvironment).toContain('label="Provider"');
    expect(paneEnvironment).toContain('label="TTFT"');
    expect(paneEnvironment).toContain('label="Speed"');
    expect(paneEnvironment).toContain("multiline");
    expect(environment).not.toContain("shadow-[0_28px_90px");
  });

  test("keeps the workspace header actions compact and accessible", () => {
    const workspace = readSource("ui/src/pages/chat/MultiChatWorkspace.tsx");

    expect(workspace).toContain('aria-label="New chat"');
    expect(workspace).toContain('aria-label="Add existing chat"');
    expect(workspace).toContain('aria-label="Open single chat"');
    expect(workspace).not.toContain('<span className="hidden sm:inline">Add chat</span>');
    expect(workspace).not.toContain('<span className="hidden md:inline">Environments</span>');
  });

  test("hides transcript scrollbars while preserving scroll behavior", () => {
    const workspace = readSource("ui/src/pages/chat/MultiChatWorkspace.tsx");
    const chat = readSource("ui/src/pages/Chat.tsx");
    const ideChat = readSource("ui/src/pages/ide/IDEChatPanel.tsx");
    const foundation = readSource("ui/src/styles/index-foundation.css");

    expect(workspace).toContain("chat-scroll-region min-h-0 flex-1 overflow-y-auto");
    expect(chat).toContain("chat-scroll-region flex-1 overflow-y-auto");
    expect(ideChat).toContain("chat-scroll-region flex-1 overflow-y-auto");
    expect(foundation).toContain(".chat-scroll-region::-webkit-scrollbar");
    expect(foundation).toContain("scrollbar-width: none");
  });
});
