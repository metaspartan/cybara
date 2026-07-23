import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../../src/core/system-prompt";
import {
  buildArtifactTemplate,
  createArtifact,
  deleteArtifact,
  readArtifact,
} from "../../src/core/artifacts";

describe("Date and time formatting", () => {
  test("system prompt includes a cache-stable local date", () => {
    const prompt = buildSystemPrompt({
      modelDisplay: "TestModel",
      tools: ["session_status"],
      workspaceDir: "/tmp",
      userTimezone: "America/Los_Angeles",
    });

    expect(prompt).toContain("## Current Date");
    expect(prompt).toContain("(America/Los_Angeles)");
    expect(prompt).toContain("Use `session_status`");
    expect(prompt).not.toContain("UTC:");

    const localLine = prompt.split("\n").find((line) => line.startsWith("Current date:"));
    expect(localLine).toBeDefined();
    expect(localLine).toMatch(/Current date: [A-Za-z]+, \d{4}-\d{2}-\d{2}/);
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

  test("artifact create normalizes stale artifact date fields to current year", () => {
    const sessionId = `artifact-date-${Date.now()}`;
    const staleContent = [
      "# Notes",
      "",
      "**Date:** February 22, 2025",
      "",
      "Body",
      "",
      "---",
      "Session: wrong-session",
      "Updated: Friday, 2025-02-21 00:00:00 (UTC)",
      "Updated (UTC): 2025-02-21T00:00:00.000Z",
      "",
    ].join("\n");

    createArtifact({
      sessionId,
      name: "notes",
      kind: "notes",
      content: staleContent,
      overwrite: true,
    });

    const read = readArtifact({ sessionId, name: "notes" });
    const updatedUtcLine = read.content
      .split("\n")
      .find((line) => line.startsWith("Updated (UTC):"));
    const updatedBodyDateLine = read.content
      .split("\n")
      .find((line) => line.toLowerCase().includes("date:"));

    expect(read.content).toContain(`Session: ${sessionId}`);
    expect(updatedUtcLine).toBeDefined();
    expect(updatedBodyDateLine).toBeDefined();
    const currentYear = String(new Date().getUTCFullYear());
    expect(updatedUtcLine).toContain(`${currentYear}-`);
    expect(updatedBodyDateLine).toContain(currentYear);
    expect(read.content).not.toContain("Updated (UTC): 2025-02-21T00:00:00.000Z");
    expect(read.content).not.toContain("**Date:** February 22, 2025");

    deleteArtifact({ sessionId, name: "notes" });
  });
});
