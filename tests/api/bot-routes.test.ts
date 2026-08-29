import { afterEach, describe, expect, test } from "bun:test";
import { botRoutes } from "../../src/api/bot-routes";
import { deleteSession, getSession } from "../../src/api/chat-session-api";
import { agentManager } from "../../src/core/agent";
import { taskScheduler } from "../../src/core/scheduler";
import { botSessionId } from "../../shared/bot-mode";

const createdAgentIds: string[] = [];
const createdTaskIds: string[] = [];

afterEach(async () => {
  for (const id of createdTaskIds.splice(0)) taskScheduler.delete(id);
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

  test("keeps bot identity durable and supports profile lifecycle actions", async () => {
    const create = botRoutes["POST /api/bots"];
    const update = botRoutes["PUT /api/bots/:id"];
    const duplicate = botRoutes["POST /api/bots/:id/duplicate"];
    const remove = botRoutes["DELETE /api/bots/:id"];
    const list = botRoutes["GET /api/bots"];
    const base = agentManager.create({
      name: "Bot Lifecycle Template",
      type: "planner",
      model: "glm-5.3",
      system_prompt: "Use concise evidence.",
      memory_enabled: true,
      config: { tool_profile: "full" },
    });
    createdAgentIds.push(base.id);
    const created = (await create?.({
      name: "Atlas Lead",
      title: "Release coordinator",
      description: "Coordinate specialists and never publish without approval.",
      base_agent_id: base.id,
    })) as { bot: { id: string }; session_id: string };
    createdAgentIds.push(created.bot.id);
    const sourceTask = taskScheduler.create({
      name: "Check release status",
      action: "Review the current release status",
      type: "recurring",
      agent_id: created.bot.id,
      session_id: created.session_id,
      schedule: "0 9 * * *",
    });
    createdTaskIds.push(sourceTask.id);

    const createdAgent = agentManager.get(created.bot.id);
    expect(createdAgent?.system_prompt).toContain("Use concise evidence.");
    expect(createdAgent?.system_prompt).toContain("You are Atlas Lead, a persistent Cybara bot.");
    expect(createdAgent?.system_prompt).toContain("never publish without approval");

    const updated = (await update?.(
      {
        name: "Atlas Director",
        title: "Launch director",
        description: "Own launch readiness and require approval before publishing.",
        pinned: true,
        hidden: true,
      },
      { id: created.bot.id }
    )) as { bot: { name: string; pinned: boolean; hidden: boolean } };
    expect(updated.bot).toMatchObject({ name: "Atlas Director", pinned: true, hidden: true });
    const updatedPrompt = agentManager.get(created.bot.id)?.system_prompt || "";
    expect(updatedPrompt).toContain("Use concise evidence.");
    expect(updatedPrompt).toContain("You are Atlas Director, a persistent Cybara bot.");
    expect(updatedPrompt).not.toContain("Coordinate specialists");

    const roster = (await list?.()) as {
      bots: Array<{ id: string; hidden: boolean; pinned: boolean }>;
    };
    expect(roster.bots.find((bot) => bot.id === created.bot.id)).toMatchObject({
      hidden: true,
      pinned: true,
    });

    const cloned = (await duplicate?.({}, { id: created.bot.id })) as {
      bot: { id: string; name: string; hidden: boolean; pinned: boolean };
      session_id: string;
      duplicated_tasks: number;
    };
    createdAgentIds.push(cloned.bot.id);
    expect(cloned.bot).toMatchObject({
      name: "Atlas Director copy",
      hidden: false,
      pinned: false,
    });
    expect((await getSession(cloned.session_id))?.messages).toEqual([]);
    expect(agentManager.get(cloned.bot.id)?.system_prompt).toContain("Launch director");
    expect(cloned.duplicated_tasks).toBe(1);
    const clonedTask = taskScheduler.list().find((task) => task.agent_id === cloned.bot.id);
    expect(clonedTask).toMatchObject({
      name: "Check release status",
      session_id: cloned.session_id,
      status: "paused",
    });
    if (clonedTask) createdTaskIds.push(clonedTask.id);

    expect(await remove?.({}, { id: cloned.bot.id })).toEqual({
      success: true,
      bot_id: cloned.bot.id,
      deleted_tasks: 1,
    });
    expect(agentManager.get(cloned.bot.id)).toBeUndefined();
    expect(await getSession(cloned.session_id)).toBeUndefined();
    expect(taskScheduler.list().some((task) => task.agent_id === cloned.bot.id)).toBe(false);
  });
});
