import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

describe("bot sidebar wiring", () => {
  test("switches between sessions and bots above the primary creation action", () => {
    const source = readFileSync(resolve(root, "ui/src/components/layout/Sidebar.tsx"), "utf8");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('sidebarMode === "sessions"');
    expect(source).toContain('sidebarMode === "bots"');
    expect(source.indexOf('role="tablist"')).toBeLessThan(source.indexOf('"New Bot"'));
    expect(source).toContain("<BotSidebar");
  });

  test("opens bots through the shared chat route and composer runtime", () => {
    const source = readFileSync(resolve(root, "ui/src/pages/chat/BotSidebar.tsx"), "utf8");
    const chat = readFileSync(resolve(root, "ui/src/pages/Chat.tsx"), "utf8");
    const controls = readFileSync(resolve(root, "ui/src/pages/chat/ChatAgentControls.tsx"), "utf8");
    expect(source).toContain("botsApi.ensureSession");
    expect(source).toContain("buildSessionChatPath(sessionId)");
    expect(source).toContain("navigate(buildFreshChatPath())");
    expect(source).not.toContain('navigate("/chat")');
    expect(source).not.toContain("ChatInput");
    expect(chat).toContain("agentLocked: currentBot !== null");
    expect(chat).toContain("sessionId,");
    expect(controls).toContain("{locked ? (");
    expect(controls).toContain("chat-agent-locked-label");
    expect(controls).not.toContain("disabled={updating || locked}");
    expect(chat).toContain("agentLockedLabel: roomComposerLabel(currentRoom)");
    expect(chat).toContain("conversationStyle={currentBot !== null || currentRoom !== null}");
  });

  test("exposes durable profile, team, visibility, and routine actions", () => {
    const sidebar = readFileSync(resolve(root, "ui/src/pages/chat/BotSidebar.tsx"), "utf8");
    const emptyState = readFileSync(resolve(root, "ui/src/pages/chat/ChatEmptyState.tsx"), "utf8");
    const workspaceBar = readFileSync(
      resolve(root, "ui/src/pages/chat/NewChatWorkspaceBar.tsx"),
      "utf8"
    );
    const tasks = readFileSync(resolve(root, "ui/src/pages/Tasks.tsx"), "utf8");

    expect(sidebar).toContain("Edit bot profile");
    expect(sidebar).toContain("botsApi.duplicate");
    expect(sidebar).toContain("botsApi.delete");
    expect(sidebar).toContain(">\n          Team\n        </button>");
    expect(sidebar).toContain('t("chat.room.newRoom")');
    expect(sidebar).toContain("<RoomCreateModal");
    expect(sidebar).toContain('t("chat.room.delete")');
    expect(sidebar).toContain("buildMultiChatPath(sessions)");
    expect(sidebar).toContain("Routines");
    expect(sidebar).toContain("setActionBotId(null)");
    expect(sidebar).toContain("Access and safety");
    expect(sidebar).toContain("bot.routine_count");
    expect(sidebar).not.toContain('role="button"');
    expect(sidebar).toContain("assigned routines");
    expect(sidebar).toContain("maxLength={2000}");
    expect(sidebar).toContain("pinned: !bot.pinned");
    expect(sidebar).toContain("hidden: !bot.hidden");
    expect(sidebar).toContain("Model and provider");
    expect(sidebar).toContain("provider_id: editDraft.providerId");
    expect(sidebar).toContain("profile_image: editDraft.profileImage");
    expect(sidebar).toContain("BOT_PROFILE_IMAGE_ACCEPT");
    expect(sidebar).toContain("Add picture");
    expect(sidebar).toContain("Remove picture");
    expect(sidebar).toContain("useAgentSummaries");
    expect(sidebar).toContain('label="Agent"');
    expect(sidebar).toContain("selectableBotBaseAgents");
    expect(sidebar).toContain("base_agent_id: selectedBaseAgentId || undefined");
    const createForm = sidebar.slice(
      sidebar.indexOf('id="create-bot-form"'),
      sidebar.indexOf('title="Edit bot profile"')
    );
    expect(createForm).not.toContain("Model and provider");
    expect(createForm).not.toContain('label="Provider"');
    expect(createForm).not.toContain('label="Model"');
    expect(sidebar).toContain("var(--surface-hover)");
    expect(emptyState).toContain("Message <span");
    expect(emptyState).toContain("Persistent memory");
    expect(emptyState).toContain('appearance={bot ? "bot" : "session"}');
    expect(workspaceBar).toContain("rounded-2xl border");
    expect(workspaceBar).toContain("Choose a project folder for this chat");
    expect(workspaceBar).toContain("FolderOpen");
    expect(tasks).toContain('searchParams.get("agent")');
    expect(tasks).toContain('searchParams.get("session")');
    expect(tasks).toContain("Scheduled work and recent runs for this bot");
    expect(tasks).toContain("View all tasks");
    expect(tasks).toContain("Back to bot");
    expect(tasks).toContain("task-action-grid grid w-full grid-cols-2 gap-2 lg:flex");
    expect(tasks).toContain(
      'key={`agent:${task?.id ?? "new"}:${defaultAgentId}:${agents.length}`}'
    );
    expect(tasks).toContain(
      'key={`session:${task?.id ?? "new"}:${defaultSessionId}:${sessions.length}`}'
    );
  });

  test("keeps bot profiles out of the general agent settings roster", () => {
    const agents = readFileSync(resolve(root, "ui/src/pages/Agents.tsx"), "utf8");
    const mobileSurface = readFileSync(
      resolve(root, "apps/mobile/src/screens/dashboardSurfaceData.ts"),
      "utf8"
    );
    expect(agents).toContain("!agent.is_bot");
    expect(mobileSurface).toContain("if (agent.is_bot) return rows");
  });

  test("keeps the selected bot highlighted after the chat route is canonicalized", () => {
    const source = readFileSync(resolve(root, "ui/src/components/layout/Sidebar.tsx"), "utf8");
    expect(source).toContain("readPersistedSessionId()");
    expect(source).toContain('new URLSearchParams(location.search).get("session") ||');
  });
});
