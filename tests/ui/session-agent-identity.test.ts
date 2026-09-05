import { describe, expect, test } from "bun:test";
import type { AgentSummary } from "../../ui/src/types";
import {
  buildSessionAgentIdentities,
  resolveSessionAgentIdentity,
} from "../../ui/src/pages/sessionAgentIdentity";

const agents: AgentSummary[] = [
  { id: "agent-key", name: "Cybara", is_bot: false },
  { id: "bot-key", name: "Loretta", is_bot: true },
];

describe("session agent identities", () => {
  const identities = buildSessionAgentIdentities(agents);

  test("resolves a regular agent name", () => {
    expect(resolveSessionAgentIdentity(identities, "agent-key")).toEqual({
      name: "Cybara",
      isBot: false,
    });
  });

  test("resolves a bot name and identity", () => {
    expect(resolveSessionAgentIdentity(identities, "bot-key")).toEqual({
      name: "Loretta",
      isBot: true,
    });
  });

  test("falls back to the key for an unresolved agent", () => {
    expect(resolveSessionAgentIdentity(identities, "deleted-agent-key")).toEqual({
      name: "deleted-agent-key",
      isBot: false,
    });
  });
});
