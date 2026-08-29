import { describe, expect, test } from "bun:test";
import {
  defaultCollapsedSessionGroupIds,
  expandSelectedSessionGroup,
  groupSessionsForSidebar,
  workspaceSidebarLabel,
  type ChatSidebarSession,
} from "../../ui/src/pages/chat/sessionGrouping";

function session(params: Partial<ChatSidebarSession> & { id: string }): ChatSidebarSession {
  return {
    title: params.id,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...params,
  };
}

describe("chat session sidebar grouping", () => {
  test("puts pinned chats first and groups remaining chats by workspace", () => {
    const groups = groupSessionsForSidebar(
      [
        session({
          id: "unpinned-a",
          title: "Build release",
          workspace_dir: "/Users/carsen/Documents/GitHub/cybara",
          updated_at: "2026-07-01T00:00:01.000Z",
        }),
        session({
          id: "pinned",
          title: "Pinned audit",
          pinned: true,
          workspace_dir: "/tmp/other",
          updated_at: "2026-07-01T00:00:02.000Z",
        }),
        session({
          id: "unpinned-b",
          title: "No workspace chat",
          updated_at: "2026-07-01T00:00:03.000Z",
        }),
      ],
      ""
    );

    expect(groups.map((group) => group.label)).toEqual(["Pinned", "cybara", "No Workspace"]);
    expect(groups[0]?.sessions.map((item) => item.id)).toEqual(["pinned"]);
    expect(groups[1]?.sessions.map((item) => item.id)).toEqual(["unpinned-a"]);
    expect(groups[1]?.workspaceDir).toBe("/Users/carsen/Documents/GitHub/cybara");
    expect(groups[2]?.kind).toBe("unassigned");
    expect(groups[2]?.workspaceDir).toBeNull();
  });

  test("search matches stripped titles, previews, routes, and workspace names", () => {
    const groups = groupSessionsForSidebar(
      [
        session({
          id: "mini-prefixed",
          title: "Mini: Audit agent platform",
          agent_name: "Zai",
          workspace_dir: "/Users/carsen/Documents/GitHub/cybara",
        }),
        session({
          id: "preview-match",
          title: "Other chat",
          last_message: { role: "assistant", content: "Release notes and CI status" },
        }),
      ],
      "audit agent"
    );

    expect(groups.flatMap((group) => group.sessions.map((item) => item.id))).toEqual([
      "mini-prefixed",
    ]);
  });

  test("uses the workspace basename for section labels", () => {
    expect(workspaceSidebarLabel("/Users/carsen/Documents/GitHub/cybara")).toBe("cybara");
    expect(workspaceSidebarLabel(null)).toBe("No Workspace");
  });

  test("keeps canonical bot conversations out of regular session groups", () => {
    const groups = groupSessionsForSidebar(
      [session({ id: "bot:agent-one", pinned: true }), session({ id: "regular-chat" })],
      ""
    );

    expect(groups.flatMap((group) => group.sessions.map((item) => item.id))).toEqual([
      "regular-chat",
    ]);
  });

  test("starts with only the selected workspace and pinned chats expanded", () => {
    const groups = groupSessionsForSidebar(
      [
        session({ id: "pinned", pinned: true, workspace_dir: "/tmp/pinned" }),
        session({ id: "active", workspace_dir: "/work/active" }),
        session({ id: "other", workspace_dir: "/work/other" }),
        session({ id: "none" }),
      ],
      ""
    );

    expect([...defaultCollapsedSessionGroupIds(groups, "active")]).toEqual([
      "workspace:/work/other",
      "__unassigned",
    ]);
  });

  test("expands a collapsed workspace when its session becomes selected", () => {
    const groups = groupSessionsForSidebar(
      [
        session({ id: "active", workspace_dir: "/work/active" }),
        session({ id: "other", workspace_dir: "/work/other" }),
      ],
      ""
    );
    const collapsed = new Set(["workspace:/work/other"]);

    expect([...expandSelectedSessionGroup(collapsed, groups, "other")]).toEqual([]);
    expect([...collapsed]).toEqual(["workspace:/work/other"]);
  });
});
