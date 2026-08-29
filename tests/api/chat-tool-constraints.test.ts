import { describe, expect, test } from "bun:test";
import {
  constrainToolsForMessage,
  messageDisallowsAllTools,
} from "../../src/api/chat-tool-constraints";

const tools = [
  "browser",
  "computer_use",
  "capture",
  "screenshot",
  "exec",
  "process",
  "web_search",
  "web_fetch",
  "x_search",
  "sessions_spawn",
  "read",
];

describe("chat tool constraints", () => {
  test("enforces coordinated user tool exclusions", () => {
    expect(
      constrainToolsForMessage(
        "Use the embedded browser. Do not use shell commands, web search, computer use, or subagents.",
        tools
      )
    ).toEqual(["browser", "web_fetch", "read"]);
  });

  test("supports browser and fetch exclusions without removing unrelated tools", () => {
    expect(
      constrainToolsForMessage("Answer from memory without using the browser or web fetch.", tools)
    ).toEqual([
      "computer_use",
      "capture",
      "screenshot",
      "exec",
      "process",
      "web_search",
      "x_search",
      "sessions_spawn",
      "read",
    ]);
  });

  test("treats embedded browser only as an exclusive tool family", () => {
    expect(
      constrainToolsForMessage(
        "Use the embedded browser only. Inspect the page and summarize it.",
        tools
      )
    ).toEqual(["browser"]);
    expect(
      constrainToolsForMessage("Use only the embedded browser tools for this task.", tools)
    ).toEqual(["browser"]);
  });

  test("treats computer use only as an exclusive tool family", () => {
    expect(
      constrainToolsForMessage("Use computer use only. Capture the desktop and report back.", tools)
    ).toEqual(["computer_use", "capture", "screenshot"]);
  });

  test("does not constrain descriptive mentions without an explicit restriction", () => {
    expect(constrainToolsForMessage("Explain browser and computer use security.", tools)).toBe(
      undefined
    );
  });

  test("does not treat later unrelated sentences as part of a restriction", () => {
    expect(
      constrainToolsForMessage(
        "Do not use shell commands. Open the embedded browser and inspect the page.",
        tools
      )
    ).toEqual([
      "browser",
      "computer_use",
      "capture",
      "screenshot",
      "web_search",
      "web_fetch",
      "x_search",
      "sessions_spawn",
      "read",
    ]);
  });

  test("detects explicit whole-turn tool prohibitions", () => {
    expect(messageDisallowsAllTools("Keep marker COPPER-271. Do not use tools yet.")).toBe(true);
    expect(messageDisallowsAllTools("Answer in one sentence and don't call any tools.")).toBe(true);
    expect(messageDisallowsAllTools("Respond from the supplied context without using tools.")).toBe(
      true
    );
  });

  test("does not confuse scoped or descriptive tool wording with a full prohibition", () => {
    expect(messageDisallowsAllTools("Do not use shell commands. Use the browser instead.")).toBe(
      false
    );
    expect(messageDisallowsAllTools("Explain why some agents do not use tools correctly.")).toBe(
      false
    );
  });
});
