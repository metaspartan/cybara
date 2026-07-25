import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  assistantAuthorLabel,
  hasMixedAssistantAuthors,
} from "../../ui/src/pages/chat/assistantAuthors";

const ROOT_DIR = join(import.meta.dirname, "..", "..");

describe("assistant author attribution", () => {
  test("only flags transcripts that actually mix agents", () => {
    const mini = { role: "assistant", agent_id: "agent-mini", agent_name: "Mini" };
    const zai = { role: "assistant", agent_id: "agent-zai", agent_name: "Zai" };

    expect(hasMixedAssistantAuthors([{ role: "user" }, mini, { role: "user" }, mini])).toBe(false);
    expect(hasMixedAssistantAuthors([{ role: "user" }, mini, { role: "user" }, zai])).toBe(true);
    expect(hasMixedAssistantAuthors([{ role: "user" }, { role: "assistant" }])).toBe(false);
  });

  test("labels a turn with its agent and model", () => {
    expect(
      assistantAuthorLabel({ role: "assistant", agent_name: "Mini", model: "MiniMax-M3" })
    ).toBe("Mini · MiniMax-M3");
    expect(assistantAuthorLabel({ role: "assistant", model: "glm-5.2" })).toBe("glm-5.2");
    expect(assistantAuthorLabel({ role: "assistant" })).toBeNull();
    expect(assistantAuthorLabel({ role: "user", agent_name: "Mini" })).toBeNull();
  });

  test("shows attribution in both chat surfaces only for mixed transcripts", () => {
    const chat = readFileSync(join(ROOT_DIR, "ui", "src", "pages", "Chat.tsx"), "utf8");
    const multi = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "MultiChatWorkspace.tsx"),
      "utf8"
    );
    const timeline = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "ChatMessageTimeline.tsx"),
      "utf8"
    );

    expect(chat).toContain("hasMixedAssistantAuthors(typedMessages)");
    expect(chat).toContain("showAuthorAttribution={transcriptHasMixedAgents}");
    expect(multi).toContain("showAuthorAttribution={hasMixedAssistantAuthors(displayMessages)}");
    expect(timeline).toContain("showAuthorAttribution && (");
  });
});
