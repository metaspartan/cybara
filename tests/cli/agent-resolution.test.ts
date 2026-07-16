import { describe, expect, test } from "bun:test";
import { resolveAgentIdentifier } from "../../src/cli/commands/agent-resolution";

const agents = [
  { id: "gemini-id", name: "Gemini", model: "gemini-3.5-flash" },
  { id: "mini-id", name: "Mini", model: "MiniMax-M3" },
  { id: "codex-id", name: "Codex", model: "gpt-5.6-luna" },
];

describe("CLI agent resolution", () => {
  test("prefers an exact name over an earlier partial match", () => {
    expect(resolveAgentIdentifier("Mini", agents)).toBe("mini-id");
  });

  test("matches exact IDs and models without case sensitivity", () => {
    expect(resolveAgentIdentifier("CODEX-ID", agents)).toBe("codex-id");
    expect(resolveAgentIdentifier("MINIMAX-M3", agents)).toBe("mini-id");
  });

  test("retains unambiguous partial matching", () => {
    expect(resolveAgentIdentifier("gpt-5.6", agents)).toBe("codex-id");
  });

  test("rejects empty and unmatched values", () => {
    expect(resolveAgentIdentifier("  ", agents)).toBeNull();
    expect(resolveAgentIdentifier("unknown", agents)).toBeNull();
  });
});
