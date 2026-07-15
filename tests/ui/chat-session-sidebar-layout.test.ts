import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const chatSource = () =>
  readFileSync(join(process.cwd(), "ui", "src", "pages", "Chat.tsx"), "utf8") +
  readFileSync(join(process.cwd(), "ui", "src", "components", "layout", "Sidebar.tsx"), "utf8") +
  readFileSync(join(process.cwd(), "ui", "src", "pages", "chat", "chatModel.ts"), "utf8") +
  readFileSync(join(process.cwd(), "ui", "src", "pages", "chat", "ChatEmptyState.tsx"), "utf8") +
  readFileSync(
    join(process.cwd(), "ui", "src", "pages", "chat", "NewChatWorkspaceBar.tsx"),
    "utf8"
  ) +
  readFileSync(join(process.cwd(), "ui", "src", "pages", "chat", "SessionSidebar.tsx"), "utf8") +
  readFileSync(join(process.cwd(), "ui", "src", "pages", "chat", "sessionGrouping.ts"), "utf8");

const modalSource = () =>
  readFileSync(join(process.cwd(), "ui", "src", "components", "ui", "Modal.tsx"), "utf8");

const sessionSidebarSource = () =>
  readFileSync(join(process.cwd(), "ui", "src", "pages", "chat", "SessionSidebar.tsx"), "utf8");

describe("chat session sidebar layout", () => {
  test("lets session text use the full row width while actions float above it", () => {
    const source = chatSource();

    expect(source).toContain("const SESSION_PREVIEW_LIMIT = 160");
    expect(source).toContain("function sessionPreviewText");
    expect(source).toContain('content.replace(/\\s+/g, " ").trim()');
    expect(source).toContain("sessionPreviewText(session.last_message?.content),");
    expect(source).toContain('join(" ")');
    expect(source).toContain(".toLowerCase()");
    expect(source).toContain(
      "const previewText = sessionPreviewText(session.last_message?.content)"
    );
    expect(source).toContain("deferred-list-row relative px-2.5 py-1.5");
    expect(source).toContain(
      'className="min-w-0 w-full cursor-pointer text-left outline-none focus-visible:bg-[var(--surface-hover)]"'
    );
    expect(source).toContain('className="text-[12px] text-white font-medium flex w-full min-w-0');
    expect(source).toContain('className="min-w-0 flex-1 truncate">{displayTitle}</span>');
    expect(source).toContain("absolute right-2 top-1/2");
    expect(source).toContain("pointer-events-none");
    expect(source).toContain("group-hover:pointer-events-auto");
    expect(source).toContain("group-focus-within:pointer-events-auto");
    expect(source).not.toContain(
      'session.pinned\n                            ? "pointer-events-auto opacity-100"'
    );
    expect(source).toContain("const tooltip = sessionTooltipText(");
    expect(source).toContain("details.push(`${session.message_count || 0} messages`);");
    expect(source).toContain("aria-label={tooltip}");
    expect(source).toContain('data-testid="chat-session-hover-card"');
    expect(source).toContain("setHoveredSessionTooltip");
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
    expect(source).toContain("compactSidebarRelativeTime(");
    expect(source).toContain("session.updated_at || session.created_at");
    expect(source).toContain("activeSessionIds.includes(session.id)");
    expect(source).not.toContain("bg-emerald-400 flex-shrink-0");
    expect(source).not.toContain("session.last_message.content");
  });

  test("session search uses a themed autocomplete modal launched from the brand row", () => {
    const source = chatSource();
    expect(source).toContain('aria-label="Search sessions"');
    expect(source).toContain('aria-label="Clear session search"');
    expect(source).toContain('title="Search chats"');
    expect(source).toContain("searchResults.map");
    expect(source).toContain("data-autofocus");
    expect(source).toContain('surface="bare"');
    expect(source).toContain('backdrop="subtle"');
    expect(source).toContain('role="searchbox"');
    expect(source).not.toContain('type="search"');
    expect(source).toContain("!border-0");
    expect(source).toContain(
      "focus:!border-0 focus:!outline-none focus:!ring-0 focus:!shadow-none"
    );
    expect(source).toContain('setSearchQuery("")');
    expect(modalSource()).toContain(
      'backdrop === "subtle" ? "bg-black/25" : "bg-black/70 backdrop-blur-md"'
    );
  });

  test("uses semantic theme surfaces for the new-chat workspace", () => {
    const source = chatSource();

    expect(source).toContain("new-chat-workspace-bar");
    expect(source).toContain("text-[var(--text-secondary)]");
    expect(source).toContain("text-[var(--icon-muted)]");
    expect(source).not.toContain("border-blue-500/30 bg-blue-500/10");
  });

  test("uses a full-width new chat click target", () => {
    const source = chatSource();

    expect(source).toContain(
      '"flex w-full items-center gap-2.5 rounded-lg text-[13px] font-medium text-gray-400'
    );
  });

  test("clicking a session exposes immediate loading state and ignores stale loads", () => {
    const source = chatSource();
    const hookSource = readFileSync(
      join(process.cwd(), "ui", "src", "hooks", "useChat.ts"),
      "utf8"
    );

    expect(source).toContain("pendingSessionLoadId");
    expect(source).toContain("sessionLoadSequenceRef.current = loadSequence");
    expect(source).toContain("const cached = loadSession.getCached(sessionId)");
    expect(source).toContain("applyLoadedSession(sessionId, cached, sessionIsActive)");
    expect(source).toContain("const sessionIsActive = activeSessionIds.includes(sessionId)");
    expect(source).toContain("const result = await loadSession.loadFresh(sessionId)");
    expect(source).not.toContain("warmSessionDetail");
    expect(source).not.toContain("loadSession.prefetch");
    expect(source).not.toContain("SIDEBAR_IDLE_PREFETCH");
    expect(source).not.toContain("warmedSessionIdsRef");
    expect(source).not.toContain("requestIdleCallback");
    expect(source).toContain(
      "sessionLoadSequenceRef.current === loadSequence && result?.messagesList"
    );
    expect(source).toContain("const isRowLoading = pendingSessionLoadId === session.id");
    expect(source).toContain(
      "const isSessionSelected = currentSessionId === session.id || isRowLoading"
    );
    expect(source).toContain("aria-busy={isRowLoading}");
    expect(source).toContain('data-loading={isRowLoading ? "true" : undefined}');
    expect(hookSource).toContain('const SESSION_DETAIL_QUERY_KEY = "session-detail"');
    expect(hookSource).toContain("const SESSION_DETAIL_STALE_MS = 45_000");
    expect(hookSource).toContain("function sessionDetailQueryKey(sessionId: string)");
    expect(hookSource).toContain("queryClient.fetchQuery({");
    expect(hookSource).toContain("queryKey: sessionDetailQueryKey(sessionId)");
    expect(hookSource).toContain("staleTime: SESSION_DETAIL_STALE_MS");
    expect(hookSource).toContain("getCached: (sessionId: string)");
    expect(hookSource).toContain(
      'return [SESSION_DETAIL_QUERY_KEY, sessionId, "compact"] as const'
    );
    expect(hookSource).toContain("staleTime: 0");
    expect(hookSource).not.toContain("prefetch: (sessionId: string)");
    expect(hookSource).toContain("invalidateSessionDetail(queryClient");
    expect(hookSource).toContain("preserveReferenceTail = false");
    expect(hookSource).toContain("messagesList: [...cached.messagesList, userMessage]");
    expect(source).toContain("const cached = loadSessionMutation.getCached(targetSessionId)");
    expect(source).toContain("if (cached?.messagesList) applyRestoredSession(cached)");
    expect(source).toContain("const statusHydration = hydrateSessionStatus(targetSessionId)");
    expect(source).toContain("loadSessionMutation.loadFresh(targetSessionId)");
    expect(source).toContain("await statusHydration");
  });

  test("groups chat sessions into pinned and workspace sections", () => {
    const source = chatSource();
    expect(source).toContain('groupSessionsForSidebar(sessions, "")');
    expect(source).toContain('label: "Pinned"');
    expect(source).toContain("workspaceSidebarLabel(session.workspace_dir)");
    expect(source).toContain('group.kind === "pinned"');
    expect(source).toContain('group.kind === "workspace"');
    expect(source).toContain("collapsedGroupIds");
    expect(source).toContain("toggleGroupCollapsed(group.id)");
    expect(source).toContain('data-testid="chat-session-group-header"');
    expect(source).toContain("data-group-kind={group.kind}");
    expect(source).toContain('if (a.kind === "workspace" && b.kind === "unassigned") return -1;');
    expect(source).toContain('workspaceDir: key === "__unassigned" ? null');
    expect(source).toContain("PINNED_WORKSPACE_GROUPS_STORAGE_KEY");
    expect(source).toContain("toggleWorkspaceGroupPin(group.id)");
    expect(source).toContain("Reveal in Finder/Explorer");
    expect(source).toContain('apiFetch("/api/ide/reveal"');
    expect(source).toContain("aria-label={`${group.label} project actions`}");
    expect(source).toContain("onNewSession(group.workspaceDir)");
    expect(source).toContain("aria-label={`New chat in ${group.label}`}");
    expect(source).toContain("setWorkspaceDir(nextWorkspaceDir)");
    expect(source).toContain("persistWorkspaceDir(nextWorkspaceDir)");
  });

  test("keeps session hover actions neutral, theme-aware, and vertically centered", () => {
    const source = chatSource();

    expect(source).toContain("top-1/2 flex -translate-y-1/2 items-center");
    expect(source).toContain("bg-[var(--surface-panel,#11111a)]");
    expect(source).toContain("theme-muted-icon-button");
    expect(source).not.toContain("hover:bg-amber-500/20");
    expect(source).not.toContain("hover:bg-indigo-500/20 text-indigo-300");
    expect(source).not.toContain("hover:bg-red-500/20 text-red-400");
  });

  test("places active tasks directly after pinned chats", () => {
    const source = chatSource();

    expect(source).toContain("useTasks()");
    expect(source).toContain('data-testid="chat-sidebar-active-tasks"');
    expect(source).toContain("const hasPinnedGroup");
    expect(source).toContain('group.kind === "pinned"');
    expect(source).toContain("const openTask = (task: Task) =>");
    expect(source).toContain("void handleLoadSession(task.session_id)");
    expect(source).toContain('navigate("/tasks")');
    expect(source).toContain("compactTaskRunTime(task.next_run || task.last_run)");
  });

  test("selects sessions without drawing an accent outline", () => {
    const source = chatSource();

    expect(source).toMatch(
      /isSessionSelected\s*\?\s*"bg-\[rgba\(var\(--accent-primary\),0\.12\)\] border border-transparent"/
    );
    expect(source).not.toMatch(
      /isSessionSelected\s*\?\s*"bg-\[rgba\(var\(--accent-primary\),0\.12\)\] border border-\[rgba\(var\(--accent-primary\),0\.3\)\]"/
    );
  });

  test("keeps session selection separate from row management controls", () => {
    const source = sessionSidebarSource();
    expect(source).toContain("aria-label={tooltip}");
    expect(source).toContain("onClick={() => void handleLoadSession(session.id)}");
    expect(source).not.toContain('role="button"');
    expect(source).not.toContain("tabIndex={0}");
    expect(source).not.toContain('event.key !== "Enter" && event.key !== " "');
    expect(source).toContain("aria-label={`Rename ${displayTitle}`}");
    expect(source.match(/type="button"/g)?.length ?? 0).toBeGreaterThan(10);
  });
});
