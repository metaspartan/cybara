import { describe, expect, test } from "bun:test";
import {
  activeTUICapabilityMention,
  capabilitiesFromResponse,
  insertTUICapability,
  matchingTUICapabilities,
} from "../../src/cli-tui-capabilities";

describe("CLI TUI capability picker", () => {
  const capabilities = capabilitiesFromResponse({
    capabilities: [
      {
        kind: "tool",
        token: "@web-search",
        name: "web_search",
        description: "Search the web",
        source: "Tool",
      },
      {
        kind: "mcp_server",
        token: "@research",
        name: "Research",
        description: "MCP server",
        source: "MCP server",
      },
      {
        kind: "connector",
        token: "@gmail",
        name: "Gmail",
        description: "Google account connector",
        source: "Connector",
      },
    ],
  });

  test("parses validated capability data and ignores malformed rows", () => {
    expect(capabilities.map((option) => option.token)).toEqual([
      "@web-search",
      "@research",
      "@gmail",
    ]);
    expect(capabilitiesFromResponse({ capabilities: [{ token: "@broken" }] })).toEqual([]);
  });

  test("matches and inserts an active capability mention", () => {
    const input = "Please use @web";
    const active = activeTUICapabilityMention(input, input.length);
    expect(matchingTUICapabilities(capabilities, active, 6).map((option) => option.token)).toEqual([
      "@web-search",
    ]);
    if (!active) throw new Error("expected active mention");
    const option = capabilities[0];
    if (!option) throw new Error("expected capability");
    expect(insertTUICapability(input, active, option)).toEqual({
      value: "Please use @web-search ",
      cursor: 23,
    });
  });

  test("does not intercept slash commands or completed mentions", () => {
    expect(activeTUICapabilityMention("/status", 7)).toBeNull();
    expect(activeTUICapabilityMention("Use @gmail now", 14)).toBeNull();
  });
});
