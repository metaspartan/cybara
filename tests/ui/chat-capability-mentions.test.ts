import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChatCapabilityOption } from "../../ui/src/lib/api";
import {
  filterChatCapabilities,
  findActiveCapabilityMention,
  insertChatCapabilityMention,
} from "../../ui/src/pages/chat/chatCapabilityMentions";

const capabilities: ChatCapabilityOption[] = [
  {
    kind: "skill",
    token: "@model-usage",
    name: "Model Usage",
    description: "Review coding plan usage",
    source: "Skill",
  },
  {
    kind: "mcp",
    token: "@robinhood/get-portfolio",
    name: "get_portfolio",
    description: "Read the current portfolio",
    source: "Robinhood",
  },
];

const capabilityMenuPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatCapabilityMenu.tsx", import.meta.url)
);

describe("chat capability mention composer", () => {
  test("detects an active mention at the cursor", () => {
    expect(findActiveCapabilityMention("Please use @model", 17)).toEqual({
      start: 11,
      end: 17,
      query: "model",
    });
    expect(findActiveCapabilityMention("email@example.com", 17)).toBeNull();
    expect(findActiveCapabilityMention("@model finished", 15)).toBeNull();
  });

  test("supports MCP server and tool queries", () => {
    expect(findActiveCapabilityMention("Use @robinhood/get", 18)).toEqual({
      start: 4,
      end: 18,
      query: "robinhood/get",
    });
    expect(filterChatCapabilities(capabilities, "robinhood/get")).toEqual([capabilities[1]]);
  });

  test("ranks prefix matches and limits results", () => {
    expect(filterChatCapabilities(capabilities, "model", 1)).toEqual([capabilities[0]]);
    expect(filterChatCapabilities(capabilities, "portfolio")).toEqual([capabilities[1]]);
  });

  test("replaces only the active mention and places the cursor after it", () => {
    const active = findActiveCapabilityMention("Before @mod after", 11);
    expect(active).not.toBeNull();
    if (!active) throw new Error("Expected an active mention");
    expect(insertChatCapabilityMention("Before @mod after", active, "@model-usage")).toEqual({
      value: "Before @model-usage after",
      cursor: 19,
    });
  });

  test("bounds malformed cursor positions", () => {
    expect(findActiveCapabilityMention("@mod", 999)).toEqual({ start: 0, end: 4, query: "mod" });
    expect(findActiveCapabilityMention("hello", -4)).toBeNull();
  });

  test("uses shared theme surfaces and mapped interaction colors", () => {
    const source = readFileSync(capabilityMenuPath, "utf8");

    expect(source).toContain("bg-[var(--surface-panel,#15161c)]");
    expect(source).toContain('index === selectedIndex ? "bg-white/10" : "hover:bg-white/5"');
    expect(source).not.toContain("bg-[#15161c]");
  });
});
