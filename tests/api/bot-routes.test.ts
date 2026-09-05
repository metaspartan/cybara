import { afterEach, describe, expect, test } from "bun:test";
import { botRoutes } from "../../src/api/bot-routes";
import { agentRoutes } from "../../src/api/agent-routes";
import { deleteSession, getSession } from "../../src/api/chat-session-api";
import { agentManager } from "../../src/core/agent";
import { taskScheduler } from "../../src/core/scheduler";
import { botSessionId } from "../../shared/bot-mode";
import { BOT_ROLE_IDS, BOT_ROLE_PRESETS } from "../../shared/bot-roles";

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
  test("keeps the bot roster separate from ordinary configured agents", async () => {
    const create = botRoutes["POST /api/bots"];
    const list = botRoutes["GET /api/bots"];
    const ensure = botRoutes["POST /api/bots/:id/session"];
    const remove = botRoutes["DELETE /api/bots/:id"];
    const ordinary = Array.from({ length: 12 }, (_, index) =>
      agentManager.create({
        name: `Configured Agent ${index + 1}`,
        type: index % 2 === 0 ? "coder" : "research",
        model: "MiniMax-M3",
        config: { tool_profile: "full" },
      })
    );
    createdAgentIds.push(...ordinary.map((agent) => agent.id));
    const created = (await create?.({
      name: "Focused Bot",
      title: "Release owner",
      description: "Keep launch work organized.",
      base_agent_id: ordinary[0]?.id,
    })) as { bot: { id: string }; session_id: string };
    createdAgentIds.push(created.bot.id);

    const roster = (await list?.()) as { bots: Array<{ id: string }> };
    expect(roster.bots.map((bot) => bot.id)).toContain(created.bot.id);
    expect(roster.bots.some((bot) => ordinary.some((agent) => agent.id === bot.id))).toBe(false);
    const summaries = (await agentRoutes["GET /api/agents/summary"]?.()) as Array<{
      id: string;
      is_bot: boolean;
    }>;
    expect(summaries.find((agent) => agent.id === created.bot.id)?.is_bot).toBe(true);
    expect(summaries.find((agent) => agent.id === ordinary[0]?.id)?.is_bot).toBe(false);
    await expect(ensure?.({}, { id: ordinary[0]?.id ?? "" })).rejects.toThrow("Bot not found");

    expect(await remove?.({}, { id: created.bot.id })).toMatchObject({
      success: true,
      bot_id: created.bot.id,
    });
    expect(
      ((await list?.()) as { bots: Array<{ id: string }> }).bots.some(
        (bot) => bot.id === created.bot.id
      )
    ).toBe(false);
  });

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

  test("applies role presets to new bots and lists the preset catalog", async () => {
    const create = botRoutes["POST /api/bots"];
    const roles = botRoutes["GET /api/bots/roles"];
    const update = botRoutes["PUT /api/bots/:id"];
    const base = agentManager.create({ name: "Role Preset Base", type: "main" });
    createdAgentIds.push(base.id);
    const catalog = (await roles?.({})) as { roles: Array<{ id: string; title: string }> };
    expect(catalog.roles.map((role) => role.id)).toEqual([...BOT_ROLE_IDS]);
    expect(catalog.roles.find((role) => role.id === "marketer")?.title).toBe("Marketer");

    const created = (await create?.({
      name: "Nova",
      role: "marketer",
      base_agent_id: base.id,
    })) as {
      bot: { id: string; role: string | null; title: string; description: string };
    };
    createdAgentIds.push(created.bot.id);
    expect(created.bot.role).toBe("marketer");
    expect(created.bot.title).toBe(BOT_ROLE_PRESETS.marketer.title);
    expect(created.bot.description).toBe(BOT_ROLE_PRESETS.marketer.description);
    expect(agentManager.get(created.bot.id)?.system_prompt).toContain(
      BOT_ROLE_PRESETS.marketer.focus
    );

    const updated = (await update?.({ role: "writer" }, { id: created.bot.id })) as {
      bot: { role: string | null; title: string };
    };
    expect(updated.bot.role).toBe("writer");
    expect(updated.bot.title).toBe(BOT_ROLE_PRESETS.marketer.title);
    expect(agentManager.get(created.bot.id)?.system_prompt).toContain(
      BOT_ROLE_PRESETS.writer.focus
    );

    const custom = (await create?.({ name: "Plain", role: "bogus", base_agent_id: base.id })) as {
      bot: { id: string; role: string | null };
    };
    createdAgentIds.push(custom.bot.id);
    expect(custom.bot.role).toBeNull();
  });

  test("rejects malformed names and unknown bot ids", async () => {
    const create = botRoutes["POST /api/bots"];
    const ensure = botRoutes["POST /api/bots/:id/session"];
    await expect(create?.({ name: "   " })).rejects.toThrow("Bot name is required");
    await expect(create?.({ name: "Invalid provider", provider_id: "missing" })).rejects.toThrow(
      "Provider not found"
    );
    await expect(ensure?.({}, { id: "missing" })).rejects.toThrow("Bot not found");
  });

  test("rejects ambiguous handles and gives repeated duplicates unique identities", async () => {
    const create = botRoutes["POST /api/bots"];
    const update = botRoutes["PUT /api/bots/:id"];
    const duplicate = botRoutes["POST /api/bots/:id/duplicate"];
    const lead = (await create?.({ name: "Launch Lead" })) as { bot: { id: string } };
    const scout = (await create?.({ name: "Risk Scout" })) as { bot: { id: string } };
    createdAgentIds.push(lead.bot.id, scout.bot.id);

    await expect(create?.({ name: "Launch  Lead!" })).rejects.toThrow(
      "@launch-lead is already used by Launch Lead"
    );
    await expect(update?.({ name: "Launch-Lead" }, { id: scout.bot.id })).rejects.toThrow(
      "@launch-lead is already used by Launch Lead"
    );

    const firstCopy = (await duplicate?.({}, { id: lead.bot.id })) as {
      bot: { id: string; name: string };
    };
    const secondCopy = (await duplicate?.({}, { id: lead.bot.id })) as {
      bot: { id: string; name: string };
    };
    createdAgentIds.push(firstCopy.bot.id, secondCopy.bot.id);
    expect(firstCopy.bot.name).toBe("Launch Lead copy");
    expect(secondCopy.bot.name).toBe("Launch Lead copy 2");
  });

  test("keeps fresh bot identity prompts clean and bounds teammate context", async () => {
    const create = botRoutes["POST /api/bots"];
    const update = botRoutes["PUT /api/bots/:id"];
    const base = agentManager.create({
      name: "Fresh Bot Template",
      type: "main",
      model: "test-model",
      config: { tool_profile: "full" },
    });
    createdAgentIds.push(base.id);
    const lead = (await create?.({
      name: "Launch Lead",
      title: "Launch owner",
      base_agent_id: base.id,
    })) as { bot: { id: string } };
    createdAgentIds.push(lead.bot.id);
    const longDescription = `${"evidence ".repeat(60)}TAIL_SHOULD_NOT_ENTER_TEAM_PROMPTS`;
    const researcher = (await create?.({
      name: "Deep Research",
      title: "Research owner",
      description: longDescription,
      base_agent_id: base.id,
    })) as { bot: { id: string } };
    createdAgentIds.push(researcher.bot.id);

    const teammatePrompt = agentManager.get(lead.bot.id)?.system_prompt || "";
    expect(teammatePrompt).toContain("@deep-research");
    expect(teammatePrompt).toContain(`agentId: ${researcher.bot.id}`);
    expect(teammatePrompt).toContain("maxToolIterations 12");
    expect(teammatePrompt).not.toContain("TAIL_SHOULD_NOT_ENTER_TEAM_PROMPTS");

    await update?.({ name: "Launch Director" }, { id: lead.bot.id });
    const updatedPrompt = agentManager.get(lead.bot.id)?.system_prompt || "";
    expect(updatedPrompt.match(/persistent Cybara bot/g)).toHaveLength(1);
    expect(updatedPrompt).toContain("You are Launch Director");
    expect(updatedPrompt).not.toContain("You are Launch Lead");
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
    expect(createdAgent?.system_prompt).toContain(
      "Honor the latest user request when it limits or forbids tool use."
    );
    expect(createdAgent?.system_prompt).toContain("this bot's own conversation");

    const teammate = (await create?.({
      name: "Launch Analyst",
      title: "Risk analyst",
      description: "Find launch risks and report evidence.",
      base_agent_id: base.id,
      model: "MiniMax-M3",
    })) as { bot: { id: string }; session_id: string };
    createdAgentIds.push(teammate.bot.id);
    expect(agentManager.get(created.bot.id)?.system_prompt).toContain("Launch Analyst");
    expect(agentManager.get(created.bot.id)?.system_prompt).toContain(
      `agentId: ${teammate.bot.id}`
    );
    expect(agentManager.get(teammate.bot.id)?.system_prompt).toContain("Atlas Lead");
    expect(agentManager.get(teammate.bot.id)?.model).toBe("MiniMax-M3");

    await expect(
      create?.({
        name: "Launch Analyst Copy",
        title: "Backup risk analyst",
        base_agent_id: teammate.bot.id,
      })
    ).rejects.toThrow("Base agent not found");
    expect(agentManager.list().some((agent) => agent.name === "Launch Analyst Copy")).toBe(false);

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
      bots: Array<{
        id: string;
        hidden: boolean;
        pinned: boolean;
        mention_handle: string;
        routine_count: number;
        active_routine_count: number;
        next_routine_at: string | null;
      }>;
    };
    expect(roster.bots.find((bot) => bot.id === created.bot.id)).toMatchObject({
      hidden: true,
      pinned: true,
      mention_handle: "atlas-director",
      routine_count: 1,
      active_routine_count: 1,
    });
    expect(roster.bots.find((bot) => bot.id === created.bot.id)?.next_routine_at).toBeString();

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

  test("stores, lists, preserves, clears, and validates profile pictures", async () => {
    const create = botRoutes["POST /api/bots"];
    const update = botRoutes["PUT /api/bots/:id"];
    const list = botRoutes["GET /api/bots"];
    const png = `data:image/png;base64,${Buffer.from(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ).toString("base64")}`;
    const created = (await create?.({ name: "Portrait Bot" })) as {
      bot: { id: string; profile_image: string };
    };
    createdAgentIds.push(created.bot.id);

    expect(created.bot.profile_image).toBe("");
    const pictured = (await update?.({ profile_image: png }, { id: created.bot.id })) as {
      bot: { profile_image: string };
    };
    expect(pictured.bot.profile_image).toBe(png);
    expect(
      ((await list?.()) as { bots: Array<{ id: string; profile_image: string }> }).bots.find(
        (bot) => bot.id === created.bot.id
      )?.profile_image
    ).toBe(png);

    const preserved = (await update?.({ title: "Still pictured" }, { id: created.bot.id })) as {
      bot: { profile_image: string };
    };
    expect(preserved.bot.profile_image).toBe(png);
    await expect(
      update?.({ profile_image: "https://example.com/untrusted.png" }, { id: created.bot.id })
    ).rejects.toThrow("Profile picture must be a PNG, JPEG, or WebP up to 2 MB");

    const cleared = (await update?.({ profile_image: "" }, { id: created.bot.id })) as {
      bot: { profile_image: string };
    };
    expect(cleared.bot.profile_image).toBe("");

    const rePictured = (await update?.({ profile_image: png }, { id: created.bot.id })) as {
      bot: { profile_image: string };
    };
    expect(rePictured.bot.profile_image).toBe(png);
    const nulled = (await update?.({ profile_image: null }, { id: created.bot.id })) as {
      bot: { profile_image: string };
    };
    expect(nulled.bot.profile_image).toBe("");

    const fromNull = (await create?.({ name: "Null Portrait Bot", profile_image: null })) as {
      bot: { id: string; profile_image: string };
    };
    createdAgentIds.push(fromNull.bot.id);
    expect(fromNull.bot.profile_image).toBe("");
  });
});
