import { describe, expect, test } from "bun:test";
import { parseSkillFile } from "../../src/core/skills/loader";

describe("SKILL.md frontmatter parity", () => {
  test("parses standard spec fields (allowed-tools, license, version, compatibility)", () => {
    const content = [
      "---",
      "name: deploy-helper",
      "description: Deploys the app when the user asks to ship a release.",
      "license: MIT",
      "version: 1.2.0",
      "compatibility: requires git and node 20+",
      "allowed-tools: Read Bash(git:*) grep",
      "---",
      "# Deploy Helper",
      "Steps to deploy.",
    ].join("\n");

    const entry = parseSkillFile(content, "/tmp/deploy-helper/SKILL.md", "local");
    expect(entry).not.toBeNull();
    expect(entry?.frontmatter.license).toBe("MIT");
    expect(entry?.frontmatter.version).toBe("1.2.0");
    expect(entry?.frontmatter.compatibility).toBe("requires git and node 20+");
    expect(entry?.frontmatter["allowed-tools"]).toBe("Read Bash(git:*) grep");
  });

  test("resolves metadata from the openclaw namespace alias", () => {
    const content = [
      "---",
      "name: mactop-monitor",
      "description: Shows live Mac resource usage.",
      'metadata: {"openclaw":{"primaryEnv":"MACTOP_KEY","requires":{"bins":["mactop"]}}}',
      "---",
      "# mactop",
      "Run mactop.",
    ].join("\n");

    const entry = parseSkillFile(content, "/tmp/mactop-monitor/SKILL.md", "local");
    expect(entry?.metadata?.primaryEnv).toBe("MACTOP_KEY");
    expect(entry?.metadata?.requires?.bins).toEqual(["mactop"]);
  });

  test("prefers the cybara namespace over openclaw when both exist", () => {
    const content = [
      "---",
      "name: dual",
      "description: A skill with both namespaces.",
      'metadata: {"cybara":{"primaryEnv":"CYBARA_KEY"},"openclaw":{"primaryEnv":"OPENCLAW_KEY"}}',
      "---",
      "# dual",
      "Body.",
    ].join("\n");

    const entry = parseSkillFile(content, "/tmp/dual/SKILL.md", "local");
    expect(entry?.metadata?.primaryEnv).toBe("CYBARA_KEY");
  });
});
