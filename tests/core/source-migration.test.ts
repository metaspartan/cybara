import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  detectMigrationSources,
  normalizeMigrationSourceKind,
  runSourceMigration,
} from "../../src/core/source-migration";

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("source migration", () => {
  test("previews OpenClaw user data without writing targets", async () => {
    const source = makeTempRoot("cybara-openclaw-source-");
    const target = makeTempRoot("cybara-openclaw-target-");
    mkdirSync(join(source, "workspace", "skills", "research"), { recursive: true });
    writeFileSync(join(source, "workspace", "MEMORY.md"), "User prefers concise updates.\n");
    writeFileSync(
      join(source, "workspace", "skills", "research", "SKILL.md"),
      "---\nname: Research Helper\ndescription: Finds source-backed answers.\n---\n"
    );

    const report = await runSourceMigration(
      { sourceKind: "openclaw", sourcePath: source, preset: "user-data", dryRun: true },
      { targetRoot: target, now: new Date("2026-07-06T00:00:00.000Z") }
    );

    expect(report.dryRun).toBe(true);
    expect(report.sourceKind).toBe("openclaw");
    expect(
      report.items.some((entry) => entry.category === "memory" && entry.status === "planned")
    ).toBe(true);
    expect(
      report.items.some((entry) => entry.category === "skill" && entry.status === "planned")
    ).toBe(true);
  });

  test("applies Hermes memories and skills into the Cybara target layout", async () => {
    const source = makeTempRoot("cybara-hermes-source-");
    const target = makeTempRoot("cybara-hermes-target-");
    mkdirSync(join(source, "memories"), { recursive: true });
    mkdirSync(join(source, "skills", "navigator"), { recursive: true });
    writeFileSync(join(source, "memories", "MEMORY.md"), "Prefer local-first agent workflows.\n");
    writeFileSync(
      join(source, "skills", "navigator", "SKILL.md"),
      "# Navigator\n\nUse repo context.\n"
    );

    const report = await runSourceMigration(
      { sourceKind: "hermes", sourcePath: source, preset: "user-data", dryRun: false },
      { targetRoot: target, now: new Date("2026-07-06T00:00:00.000Z") }
    );

    expect(report.summary.migrated).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(target, "memory", "MEMORY.md"), "utf8")).toContain(
      "Prefer local-first agent workflows."
    );
    expect(readFileSync(join(target, "skills", "hermes-navigator", "SKILL.md"), "utf8")).toContain(
      "Navigator"
    );
    expect(report.reportPath).toBeTruthy();
  });

  test("keeps provider secrets out of reports unless explicitly applied", async () => {
    const source = makeTempRoot("cybara-secret-source-");
    const target = makeTempRoot("cybara-secret-target-");
    writeFileSync(join(source, ".env"), "OPENAI_API_KEY=sk-test-secret-value\n");

    const report = await runSourceMigration(
      { sourceKind: "openclaw", sourcePath: source, preset: "full", dryRun: true },
      { targetRoot: target, now: new Date("2026-07-06T00:00:00.000Z") }
    );

    expect(
      report.items.some((entry) => entry.category === "provider" && entry.status === "skipped")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("sk-test-secret-value");
  });

  test("detects and previews a Codex installation without exposing OAuth tokens", async () => {
    const source = makeTempRoot("cybara-codex-source-");
    const target = makeTempRoot("cybara-codex-target-");
    mkdirSync(join(source, "memories"), { recursive: true });
    mkdirSync(join(source, "skills", "review"), { recursive: true });
    writeFileSync(join(source, "AGENTS.md"), "Use Bun for repository tasks.\n");
    writeFileSync(join(source, "memories", "MEMORY.md"), "Keep verification source-backed.\n");
    writeFileSync(join(source, "skills", "review", "SKILL.md"), "# Review\n\nInspect first.\n");
    writeFileSync(
      join(source, "config.toml"),
      'model = "gpt-5"\n[mcp_servers.local]\ncommand = "bun"\n'
    );
    writeFileSync(
      join(source, "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: "codex-access-secret",
          refresh_token: "codex-refresh-secret",
        },
      })
    );

    const report = await runSourceMigration(
      { sourcePath: source, preset: "full", dryRun: true, workspaceTarget: target },
      { targetRoot: target, now: new Date("2026-07-21T00:00:00.000Z") }
    );

    expect(report.sourceKind).toBe("codex");
    expect(report.items.some((entry) => entry.category === "persona")).toBe(true);
    expect(report.items.some((entry) => entry.category === "memory")).toBe(true);
    expect(report.items.some((entry) => entry.category === "skill")).toBe(true);
    expect(report.items.some((entry) => entry.category === "workspace")).toBe(true);
    expect(
      report.items.some((entry) => entry.category === "provider" && entry.status === "skipped")
    ).toBe(true);
    expect(
      report.items.some((entry) => entry.category === "archive" && entry.name === "mcp_servers")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("codex-access-secret");
    expect(JSON.stringify(report)).not.toContain("codex-refresh-secret");
  });

  test("detects Claude Code memories, skills, commands, and settings", async () => {
    const source = makeTempRoot("cybara-claude-source-");
    const target = makeTempRoot("cybara-claude-target-");
    mkdirSync(join(source, "skills", "research"), { recursive: true });
    mkdirSync(join(source, "commands"), { recursive: true });
    mkdirSync(join(source, "projects", "workspace", "memory"), { recursive: true });
    writeFileSync(join(source, "CLAUDE.md"), "Prefer small, verified changes.\n");
    writeFileSync(
      join(source, "settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_API_KEY: "anthropic-secret" },
        permissions: { allow: ["Read"] },
      })
    );
    writeFileSync(
      join(source, "skills", "research", "SKILL.md"),
      "# Research\n\nFind primary sources.\n"
    );
    writeFileSync(join(source, "commands", "verify.md"), "# Verify\n\nRun project checks.\n");
    writeFileSync(
      join(source, "projects", "workspace", "memory", "MEMORY.md"),
      "Use the repository's existing patterns.\n"
    );

    const report = await runSourceMigration(
      { sourcePath: source, preset: "full", dryRun: true, workspaceTarget: target },
      { targetRoot: target, now: new Date("2026-07-21T00:00:00.000Z") }
    );

    expect(report.sourceKind).toBe("claude-code");
    expect(report.items.filter((entry) => entry.category === "skill")).toHaveLength(2);
    expect(report.items.some((entry) => entry.category === "memory")).toBe(true);
    expect(report.items.some((entry) => entry.category === "workspace")).toBe(true);
    expect(
      report.items.some((entry) => entry.category === "archive" && entry.name === "permissions")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("anthropic-secret");
  });

  test("normalizes supported CLI source aliases", () => {
    expect(normalizeMigrationSourceKind("codex")).toBe("codex");
    expect(normalizeMigrationSourceKind("claude")).toBe("claude-code");
    expect(normalizeMigrationSourceKind("claude-code")).toBe("claude-code");
    expect(normalizeMigrationSourceKind("unknown")).toBeUndefined();
  });

  test("discovers configured Codex and Claude Code home directories", () => {
    const codexHome = makeTempRoot("cybara-codex-home-");
    const claudeHome = makeTempRoot("cybara-claude-home-");
    const previousCodexHome = process.env.CODEX_HOME;
    const previousClaudeHome = process.env.CLAUDE_CONFIG_DIR;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    try {
      const sources = detectMigrationSources();
      expect(
        sources.some(
          (source) => source.kind === "codex" && source.path === codexHome && source.exists
        )
      ).toBe(true);
      expect(
        sources.some(
          (source) => source.kind === "claude-code" && source.path === claudeHome && source.exists
        )
      ).toBe(true);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      if (previousClaudeHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaudeHome;
    }
  });
});
