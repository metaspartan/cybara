import { afterAll, describe, expect, test } from "bun:test";
import { deleteSession, getSession, listSessions } from "../../src/api/chat";
import {
  buildRoomInstruction,
  createRoomSession,
  getRoomSummary,
  parseModeratorDecision,
  parseRoomMentions,
  projectRoomTranscriptForAgent,
  type RoomParticipant,
  updateRoomSession,
} from "../../src/api/chat-room-runtime";
import type { ChatMessage } from "../../src/api/chat-types";
import { resolveRoomSessionParam } from "../../src/api/room-routes";
import { agentManager } from "../../src/core/agent";
import type { Agent } from "../../src/core/database";
import { loadSessionRoomConfig } from "../../src/core/session-context";
import {
  isRoomPassReply,
  isRoomSessionId,
  normalizeRoomConfig,
  ROOM_MAX_ROUNDS,
} from "../../shared/room-mode";

const participant = (id: string, name: string, handle = name.toLowerCase()): RoomParticipant => ({
  agent: { id, name, model: `${name}-model`, status: "stopped", memory_enabled: false } as Agent,
  handle,
});

const research = participant("agent-research", "Research");
const coder = participant("agent-coder", "Coder");
const ops = participant("agent-ops", "Ops Bot", "ops-bot");
const participants = [research, coder, ops];

describe("room config normalization", () => {
  test("dedupes participants, clamps rounds and defaults the mode", () => {
    const config = normalizeRoomConfig({
      participant_agent_ids: [" a ", "b", "a", ""],
      max_rounds: 99,
      mode: "bogus",
    });
    expect(config).toEqual({
      participantAgentIds: ["a", "b"],
      mode: "round_robin",
      maxRounds: ROOM_MAX_ROUNDS,
      moderatorAgentId: null,
      sharedContext: "",
    });
  });

  test("moderated rooms default the moderator to the first participant", () => {
    const config = normalizeRoomConfig({ participantAgentIds: ["a", "b"], mode: "moderated" });
    expect(config?.moderatorAgentId).toBe("a");
  });

  test("rejects empty rooms and recognizes room session ids", () => {
    expect(normalizeRoomConfig({ participantAgentIds: [] })).toBeNull();
    expect(isRoomSessionId("room:abc")).toBe(true);
    expect(isRoomSessionId("bot:abc")).toBe(false);
    expect(isRoomSessionId("room:")).toBe(false);
  });

  test("detects pass replies loosely", () => {
    expect(isRoomPassReply("PASS")).toBe(true);
    expect(isRoomPassReply(" pass. ")).toBe(true);
    expect(isRoomPassReply("**PASS**")).toBe(true);
    expect(isRoomPassReply("I pass on this one")).toBe(false);
  });
});

describe("room route params", () => {
  test("accepts raw and url-encoded room ids", () => {
    expect(resolveRoomSessionParam("room:abc")).toBe("room:abc");
    expect(resolveRoomSessionParam("room%3Aabc")).toBe("room:abc");
    expect(resolveRoomSessionParam("%E0%A4%A")).toBe("%E0%A4%A");
    expect(() => resolveRoomSessionParam("  ")).toThrow(/Room id is required/);
  });
});

describe("room mentions", () => {
  test("resolves handles, normalized names and ids in order without duplicates", () => {
    const mentioned = parseRoomMentions(
      "@coder can you check this? cc @ops-bot and @Coder again, also @agent-research",
      participants
    );
    expect(mentioned.map((entry) => entry.agent.id)).toEqual([
      "agent-coder",
      "agent-ops",
      "agent-research",
    ]);
  });

  test("ignores emails and unknown handles", () => {
    expect(parseRoomMentions("mail me at dev@coder.io or ping @nobody", participants)).toEqual([]);
  });
});

describe("room prompts", () => {
  test("instruction names the speaker, the roster and the pass rule", () => {
    const instruction = buildRoomInstruction({
      self: coder,
      participants,
      config: {
        participantAgentIds: participants.map((entry) => entry.agent.id),
        mode: "round_robin",
        maxRounds: 3,
        moderatorAgentId: null,
        sharedContext: "Ship v2 by Friday",
      },
      round: 2,
      allowPass: true,
    });
    expect(instruction).toContain("You are Coder (@coder)");
    expect(instruction).toContain("@research = Research (Research-model)");
    expect(instruction).toContain("@ops-bot = Ops Bot (Ops Bot-model)");
    expect(instruction).not.toContain("@coder = Coder");
    expect(instruction).toContain("round 2 of at most 3");
    expect(instruction).toContain("reply with exactly PASS");
    expect(instruction).toContain("Shared room context: Ship v2 by Friday");
  });

  test("transcript projection relabels other agents as user turns and keeps own turns", () => {
    const transcript: ChatMessage[] = [
      { role: "system", content: "old prompt" },
      { role: "user", content: "Plan the launch." },
      {
        role: "assistant",
        content: "[written by Research]\nWe need a checklist.",
        agent_id: "agent-research",
        agent_name: "Research",
      },
      { role: "assistant", content: "I will write the script.", agent_id: "agent-coder" },
      { role: "user", content: "Sounds good." },
    ];
    const projected = projectRoomTranscriptForAgent(
      transcript,
      "agent-coder",
      "coder prompt",
      "[Room]: your turn"
    );
    expect(projected.map((message) => [message.role, message.content])).toEqual([
      ["system", "coder prompt"],
      ["user", "[User]: Plan the launch.\n\n[Research]: We need a checklist."],
      ["assistant", "I will write the script."],
      ["user", "[User]: Sounds good.\n\n[Room]: your turn"],
    ]);
  });

  test("moderator decisions accept json, handles and end signals", () => {
    expect(parseModeratorDecision('{"next":"ops-bot","note":"ops knows"}', participants)).toEqual({
      next: ops,
      note: "ops knows",
      end: false,
    });
    expect(parseModeratorDecision('{"next":"none"}', participants).end).toBe(true);
    expect(parseModeratorDecision('{"next":"stop"}', participants).end).toBe(true);
    expect(parseModeratorDecision("Let @coder answer", participants).next).toBe(coder);
    expect(parseModeratorDecision('{"next":"NONE"}', participants).end).toBe(true);
  });

  test("prose without a decision does not end the discussion", () => {
    for (const reply of [
      "nothing useful",
      "Let me think about who should go next.",
      '{"next":"someone-who-left"}',
      "research, can you check?",
      "We are done here",
    ]) {
      expect(parseModeratorDecision(reply, participants)).toEqual({
        next: null,
        note: "",
        end: false,
      });
    }
  });
});

describe("room persistence", () => {
  const createdAgents: string[] = [];
  const createdSessions: string[] = [];

  afterAll(async () => {
    for (const sessionId of createdSessions) await deleteSession(sessionId);
    for (const agentId of createdAgents) agentManager.delete(agentId);
  });

  test("creates a room session that survives eviction and exposes its config", async () => {
    const alpha = agentManager.create({ name: `Room Alpha ${crypto.randomUUID().slice(0, 6)}` });
    const beta = agentManager.create({ name: `Room Beta ${crypto.randomUUID().slice(0, 6)}` });
    createdAgents.push(alpha.id, beta.id);

    const room = await createRoomSession({
      participantAgentIds: [alpha.id, beta.id],
      mode: "mention_only",
      maxRounds: 2,
    });
    createdSessions.push(room.sessionId);
    expect(isRoomSessionId(room.sessionId)).toBe(true);
    expect(room.title).toBe(`Room: ${alpha.name}, ${beta.name}`);
    expect(room.participants.map((entry) => entry.id)).toEqual([alpha.id, beta.id]);

    expect(loadSessionRoomConfig(room.sessionId)).toEqual({
      participantAgentIds: [alpha.id, beta.id],
      mode: "mention_only",
      maxRounds: 2,
      moderatorAgentId: null,
      sharedContext: "",
    });

    const session = await getSession(room.sessionId);
    expect(session?.agentId).toBe(alpha.id);
    expect((session as { room?: unknown } | undefined)?.room).toMatchObject({
      mode: "mention_only",
    });

    const listed = (await listSessions()).find((entry) => entry.id === room.sessionId);
    expect(listed?.room?.mode).toBe("mention_only");

    const updated = await updateRoomSession(room.sessionId, {
      mode: "moderated",
      maxRounds: 1,
    });
    expect(updated.config.mode).toBe("moderated");
    expect(updated.config.moderatorAgentId).toBe(alpha.id);
    expect((await getRoomSummary(room.sessionId))?.config.maxRounds).toBe(1);
  });

  test("rejects unknown participants", async () => {
    await expect(createRoomSession({ participantAgentIds: ["missing-agent-id"] })).rejects.toThrow(
      /unknown agent/
    );
  });
});
