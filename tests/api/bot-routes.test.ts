import { afterEach, describe, expect, test } from "bun:test";
import { botRoutes } from "../../src/api/bot-routes";
import { deleteSession, getSession } from "../../src/api/chat-session-api";
import { agentManager } from "../../src/core/agent";
import { botSessionId } from "../../shared/bot-mode";

const createdAgentIds: string[] = [];

afterEach(async () => {
  for (const id of createdAgentIds.splice(0)) {
    await deleteSession(botSessionId(id));
    agentManager.delete(id);
  }
});

describe("bot routes", () => {
  test("creates a persistent bot and restores its canonical pinned conversation", async () => {
    const create = botRoutes["POST /api/bots"];
    const list = botRoutes["GET /api/bots"];
    const ensure = botRoutes["POST /api/bots/:id/session"];
    const base = agentManager.create({
      name: "Bot Test Template",
      type: "coder",
      model: "MiniMax-M3",
      memory_enabled: true,
      config: { tool_profile: "full" },
    });
    createdAgentIds.push(base.id);
    const response = (await create?.({
      name: "Release Scout",
      title: "Release readiness",
      description: "Tracks checks and release risks",
      base_agent_id: base.id,
    })) as {
      success: boolean;
      bot: { id: string; name: string; title: string; description: string; model?: string };
      session_id: string;
    };
    createdAgentIds.push(response.bot.id);

    expect(response.success).toBe(true);
    expect(response.session_id).toBe(botSessionId(response.bot.id));
    expect(response.bot).toMatchObject({
      name: "Release Scout",
      title: "Release readiness",
      description: "Tracks checks and release risks",
      model: "MiniMax-M3",
    });

    const secondOpen = (await ensure?.({}, { id: response.bot.id })) as {
      success: boolean;
      session_id: string;
    };
    expect(secondOpen).toEqual({
      success: true,
      bot_id: response.bot.id,
      session_id: response.session_id,
    });

    const restored = await getSession(response.session_id);
    expect(restored).toMatchObject({
      id: response.session_id,
      agentId: response.bot.id,
      title: "Release Scout",
      messages: [],
    });

    const roster = (await list?.()) as {
      bots: Array<{ id: string; session_id: string; session: { title: string } | null }>;
    };
    expect(roster.bots.find((bot) => bot.id === response.bot.id)).toMatchObject({
      session_id: response.session_id,
      session: { title: "Release Scout" },
    });
  });

  test("rejects malformed names and unknown bot ids", async () => {
    const create = botRoutes["POST /api/bots"];
    const ensure = botRoutes["POST /api/bots/:id/session"];
    await expect(create?.({ name: "   " })).rejects.toThrow("Bot name is required");
    await expect(ensure?.({}, { id: "missing" })).rejects.toThrow("Bot not found");
  });
});
