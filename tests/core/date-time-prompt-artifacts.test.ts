import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../../src/core/system-prompt";
import { buildArtifactTemplate } from "../../src/core/artifacts";

describe("Date and time formatting", () => {
  test("system prompt includes local and UTC timestamps", () => {
    const prompt = buildSystemPrompt({
      modelDisplay: "TestModel",
      tools: ["session_status"],
      workspaceDir: "/tmp",
      userTimezone: "America/Los_Angeles",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Los_Angeles");
    expect(prompt).toContain("Local (America/Los_Angeles):");
    expect(prompt).toContain("UTC:");
    expect(prompt).toContain("run `session_status`");

    const localLine = prompt
      .split("\n")
      .find((line) => line.startsWith("Local (America/Los_Angeles):"));
    expect(localLine).toBeDefined();
    expect(localLine).toMatch(
      /Local \(America\/Los_Angeles\): [A-Za-z]+, \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
    );
  });

  test("artifact templates include local and UTC updated timestamps", () => {
    const template = buildArtifactTemplate({
      sessionId: "session-1",
      kind: "task",
      now: new Date("2026-02-21T01:30:45.000Z"),
      timeZone: "America/Los_Angeles",
    });

    expect(template).toContain("Session: session-1");
    expect(template).toContain("Updated: ");
    expect(template).toContain("(America/Los_Angeles)");
    expect(template).toContain("Updated (UTC): 2026-02-21T01:30:45.000Z");
    expect(template).toContain("2026-02-20");
  });
});
