import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { SessionMessageSummary } from "../../apps/mobile/src/lib/api";
import {
  mobileMessageAuthorLabel,
  mobileTranscriptHasMixedAuthors,
} from "../../apps/mobile/src/screens/dashboardMessageAuthors";

const ROOT_DIR = join(import.meta.dirname, "..", "..");

const assistant = (agentId: string, agentName: string, model: string): SessionMessageSummary =>
  ({
    id: `m-${agentId}`,
    role: "assistant",
    content: "hi",
    agentId,
    agentName,
    model,
  }) as SessionMessageSummary;

describe("per-message agent attribution parity", () => {
  test("mobile flags only genuinely mixed transcripts", () => {
    const mini = assistant("agent-mini", "Mini", "MiniMax-M3");
    const kimi = assistant("agent-kimi", "Kimi", "k3");
    expect(mobileTranscriptHasMixedAuthors([mini, mini])).toBe(false);
    expect(mobileTranscriptHasMixedAuthors([mini, kimi])).toBe(true);
    expect(
      mobileTranscriptHasMixedAuthors([
        { id: "u", role: "user", content: "x" } as SessionMessageSummary,
      ])
    ).toBe(false);
  });

  test("mobile label matches the web format", () => {
    expect(mobileMessageAuthorLabel(assistant("agent-kimi", "Kimi", "k3"))).toBe("Kimi · k3");
    expect(
      mobileMessageAuthorLabel({
        id: "m",
        role: "assistant",
        content: "x",
        model: "glm-5.2",
      } as SessionMessageSummary)
    ).toBe("glm-5.2");
    expect(
      mobileMessageAuthorLabel({
        id: "m",
        role: "user",
        content: "x",
        agentName: "Mini",
      } as SessionMessageSummary)
    ).toBeNull();
  });

  test("the gateway sends per-message authorship every client can read", () => {
    const shared = readFileSync(join(ROOT_DIR, "src", "api", "chat-session-api.ts"), "utf8");
    expect(shared).toContain('"agent_id"');
    expect(shared).toContain('"agent_name"');
  });

  test("all three chat surfaces render the attribution", () => {
    const web = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "ChatMessageTimeline.tsx"),
      "utf8"
    );
    const mobile = readFileSync(
      join(ROOT_DIR, "apps", "mobile", "src", "screens", "dashboardChat.tsx"),
      "utf8"
    );
    const macos = readFileSync(
      join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara", "NativeChatTimeline.swift"),
      "utf8"
    );

    expect(web).toContain("<AssistantAuthorLabel message={message} />");
    expect(mobile).toContain("<MessageAuthorLabel message={message} />");
    expect(macos).toContain("messageAuthorLabel(message)");
  });

  test("macOS decodes the per-message agent fields", () => {
    const models = readFileSync(
      join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara", "GatewayChatModels.swift"),
      "utf8"
    );
    expect(models).toContain("agent_name = try container.decodeFlexibleString");
    expect(models).toContain("case agent_id, agentId, agent_name, agentName, model");
  });
});
