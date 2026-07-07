import { describe, expect, test } from "bun:test";
import {
  deriveSessionTitleFromMessages,
  deriveSessionTitleFromTurn,
  normalizeSessionTitle,
  parseModelGeneratedSessionTitle,
  shouldRegenerateSessionTitle,
  stripSessionTitleAgentPrefix,
} from "../../src/core/session-title";

describe("session title derivation", () => {
  test("prefers assistant-derived conversation title over first user prompt", () => {
    const title = deriveSessionTitleFromMessages(
      [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hey can you audit my codebase and make a report" },
        {
          role: "assistant",
          content:
            "# Cybara Codebase Audit Report\n\nI audited the project and prepared a full findings report.",
        },
      ],
      "Mini"
    );

    expect(title).toBe("Cybara Codebase Audit Report");
    expect(title).not.toContain("hey can you");
  });

  test("falls back to user request summary when assistant response is unavailable", () => {
    const title = deriveSessionTitleFromMessages(
      [{ role: "user", content: "please fix telegram reactions and discord media handling" }],
      "Mini"
    );

    expect(title).toBe("fix telegram reactions and discord media handling");
  });

  test("deriveSessionTitleFromTurn uses assistant content when it is meaningful", () => {
    const title = deriveSessionTitleFromTurn(
      "can you improve onboarding",
      "Implemented onboarding flow with provider search and agent creation guidance."
    );

    expect(title).toBe(
      "Implemented onboarding flow with provider search and agent creation guidance"
    );
  });

  test("ignores generic assistant headings like Summary and falls back to user intent", () => {
    const title = deriveSessionTitleFromMessages(
      [
        { role: "user", content: "please fix discord media and reaction handling" },
        { role: "assistant", content: "## Summary\n\nImplemented changes and validated behavior." },
      ],
      "Mini"
    );

    expect(title).toBe("fix discord media and reaction handling");
    expect(title.toLowerCase()).not.toBe("summary");
  });

  test("normalization trims markdown/noise and enforces title limits", () => {
    const title = normalizeSessionTitle(
      "  ###   This   is   a   very   long   title   with   many   extra   words   that   should   be   compacted   cleanly   "
    );

    expect(title).toBe("This is a very long title with many extra words that should");
  });

  test("flags generic placeholder titles for regeneration", () => {
    expect(shouldRegenerateSessionTitle("Summary")).toBe(true);
    expect(shouldRegenerateSessionTitle("Session")).toBe(true);
    expect(shouldRegenerateSessionTitle("Discord media handling fixes")).toBe(false);
  });

  test("parses model-generated title output with label prefixes", () => {
    const parsed = parseModelGeneratedSessionTitle(
      "Title: Discord Media + Reaction Handling Improvements"
    );
    expect(parsed).toBe("Discord Media + Reaction Handling Improvements");
  });

  test("rejects generic model-generated title output", () => {
    expect(parseModelGeneratedSessionTitle("Summary")).toBeNull();
  });

  test("strips matching agent prefixes without removing normal title punctuation", () => {
    expect(stripSessionTitleAgentPrefix("Mini: Audit agent platform", ["Mini"])).toBe(
      "Audit agent platform"
    );
    expect(stripSessionTitleAgentPrefix("Mini - Fix CI workflow failures", ["mini"])).toBe(
      "Fix CI workflow failures"
    );
    expect(stripSessionTitleAgentPrefix("Codex: Review release build", ["Zai"])).toBe(
      "Review release build"
    );
    expect(stripSessionTitleAgentPrefix("Fix: CI workflow failures", ["Mini"])).toBe(
      "Fix: CI workflow failures"
    );
  });
});
