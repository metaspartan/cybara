import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  isRunEndingStatus,
  isSteeringHandoffStatus,
  isToolStatusEvent,
} from "../../ui/src/pages/chat/sessionRunStatus";
import {
  MULTI_CHAT_ACTIVE_STATUSES,
  projectMultiChatStatusEvent,
} from "../../ui/src/pages/chat/multiChatLiveStatus";
import { resolveStatusSnapshotActivities } from "../../ui/src/pages/chat/chatModel";

const ROOT_DIR = join(import.meta.dirname, "..", "..");

describe("chat live run continuity", () => {
  test("treats a failed tool call as part of the run, not the end of it", () => {
    const toolFailure = {
      status: "error",
      detail: "Command failed",
      toolName: "exec_command",
      toolPhase: "error",
    };

    expect(isToolStatusEvent(toolFailure)).toBe(true);
    expect(isRunEndingStatus(toolFailure)).toBe(false);
    expect(isRunEndingStatus({ status: "error", detail: "Provider unavailable" })).toBe(true);
    expect(isRunEndingStatus({ status: "idle", detail: "Idle" })).toBe(true);
    expect(isRunEndingStatus({ status: "idle", detail: "Steering to follow-up..." })).toBe(false);
    expect(isRunEndingStatus({ status: "thinking" })).toBe(false);
    expect(isSteeringHandoffStatus({ status: "idle", detail: "Steering to follow-up..." })).toBe(
      true
    );
  });

  test("keeps multi-chat live state and records the failure when a tool errors mid-run", () => {
    const running = projectMultiChatStatusEvent(
      undefined,
      {
        type: "status",
        status: "tool_executing",
        timestamp: 1_000,
        detail: "Running bun test",
        toolName: "exec_command",
        toolCallId: "call-1",
        toolPhase: "start",
      },
      1_000
    );
    expect(running).not.toBeNull();

    const afterFailure = projectMultiChatStatusEvent(
      running ?? undefined,
      {
        type: "status",
        status: "error",
        timestamp: 1_500,
        detail: "Command failed with exit code 1",
        toolName: "exec_command",
        toolCallId: "call-1",
        toolPhase: "error",
      },
      1_500
    );

    expect(afterFailure).not.toBeNull();
    expect(MULTI_CHAT_ACTIVE_STATUSES.has(afterFailure?.status || "idle")).toBe(true);
    expect(afterFailure?.liveStatus).toBe("thinking");
    expect(afterFailure?.activities).toHaveLength(1);
    expect(afterFailure?.activities[0]?.phase).toBe("error");
    expect(afterFailure?.startedAtMs).toBe(1_000);

    expect(
      projectMultiChatStatusEvent(afterFailure ?? undefined, {
        type: "status",
        status: "idle",
        timestamp: 2_000,
        detail: "Idle",
      })
    ).toBeNull();
  });

  test("retains locally observed activities when a snapshot reports a tool failure", () => {
    const local = [
      {
        id: "activity-1",
        phase: "start" as const,
        text: "Running bun test",
        timestamp: 1_000,
        toolName: "exec_command",
      },
    ];

    expect(resolveStatusSnapshotActivities([], local, "error")).toHaveLength(1);
    expect(resolveStatusSnapshotActivities([], local, "idle")).toHaveLength(0);
  });

  test("keeps an in-flight request marked as loading when the transcript is refreshed", () => {
    const useChat = readFileSync(join(ROOT_DIR, "ui", "src", "hooks", "useChat.ts"), "utf8");
    expect(useChat).toContain("isLoading: sameSession ? prev.isLoading : false");
  });

  test("does not retire live activities onto an earlier turn while the session is working", () => {
    const chat = readFileSync(join(ROOT_DIR, "ui", "src", "pages", "Chat.tsx"), "utf8");
    expect(chat).toContain("if (currentSessionIsWorking && !isLoading) return;");
  });

  test("keeps the IDE chat and sidebar indicators live through a failed tool call", () => {
    const idePanel = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "ide", "IDEChatPanel.tsx"),
      "utf8"
    );
    const sidebarStatus = readFileSync(
      join(ROOT_DIR, "ui", "src", "components", "layout", "useSidebarAgentStatus.ts"),
      "utf8"
    );

    expect(idePanel).toContain("if (isRunEndingStatus(payload)) {");
    expect(idePanel).not.toContain('if (payload.status === "error") {');
    expect(sidebarStatus).toContain("const runEnded = isRunEndingStatus(data);");
  });

  test("preserves locally known trailing messages when reloading mid-run", () => {
    const runtime = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "useChatLiveSessionRuntime.ts"),
      "utf8"
    );
    expect(runtime).toContain('mode === "latest"');
  });
});
