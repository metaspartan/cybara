import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  countOpenCodeSessions,
  migrateOpenCodeSessions,
  readOpenCodeSessions,
  resolveOpenCodeMigrationRoots,
  type OpenCodeSessionSnapshot,
  type OpenCodeSessionStore,
} from "../../src/core/source-migration-opencode";
import { detectMigrationSources, runSourceMigration } from "../../src/core/source-migration";

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function createOpenCodeDatabase(root: string): void {
  const database = new Database(join(root, "opencode.db"), { create: true });
  database.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const session = database.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)");
  session.run("ses-active", root, "Build the importer", 1_000, 4_000, null);
  session.run("ses-archived", root, "Archived research", 5_000, 6_000, 6_000);
  const message = database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  message.run(
    "msg-user",
    "ses-active",
    1_100,
    JSON.stringify({ role: "user", time: { created: 1_100 } })
  );
  message.run(
    "msg-assistant",
    "ses-active",
    2_000,
    JSON.stringify({
      role: "assistant",
      providerID: "nvidia",
      modelID: "z-ai/glm-5.2",
      time: { created: 2_000 },
    })
  );
  message.run(
    "msg-archived",
    "ses-archived",
    5_100,
    JSON.stringify({ role: "user", time: { created: 5_100 } })
  );
  const part = database.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)");
  part.run(
    "part-user",
    "msg-user",
    "ses-active",
    1_101,
    JSON.stringify({ type: "text", text: "Continue the migration." })
  );
  part.run(
    "part-image",
    "msg-user",
    "ses-active",
    1_102,
    JSON.stringify({
      type: "file",
      mediaType: "image/png",
      filename: "preview.png",
      url: "data:image/png;base64,AQID",
    })
  );
  part.run(
    "part-reasoning",
    "msg-assistant",
    "ses-active",
    2_001,
    JSON.stringify({ type: "reasoning", text: "Inspect the schema before writing." })
  );
  part.run(
    "part-tool",
    "msg-assistant",
    "ses-active",
    2_002,
    JSON.stringify({
      type: "tool",
      tool: "read",
      callID: "call-read",
      state: {
        status: "completed",
        input: { path: "src/index.ts" },
        output: "file contents",
        time: { start: 2_100, end: 2_125 },
      },
    })
  );
  part.run(
    "part-assistant",
    "msg-assistant",
    "ses-active",
    2_003,
    JSON.stringify({ type: "text", text: "The importer is ready." })
  );
  part.run(
    "part-archived",
    "msg-archived",
    "ses-archived",
    5_101,
    JSON.stringify({ type: "text", text: "Keep archived conversations too." })
  );
  database.close();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OpenCode source migration", () => {
  test("resolves separate XDG config and data roots", () => {
    const home = tempRoot("cybara-opencode-home-");
    const configHome = join(home, "config");
    const dataHome = join(home, "data");
    const configRoot = join(configHome, "opencode");
    const dataRoot = join(dataHome, "opencode");
    mkdirSync(configRoot, { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(configRoot, "opencode.json"), "{}");
    createOpenCodeDatabase(dataRoot);

    expect(
      resolveOpenCodeMigrationRoots(
        configRoot,
        { XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: dataHome },
        home
      )
    ).toEqual({ configRoot, dataRoot });
  });

  test("converts current OpenCode chats including reasoning, tools, and archives", () => {
    const root = tempRoot("cybara-opencode-db-");
    createOpenCodeDatabase(root);

    expect(countOpenCodeSessions(root)).toBe(2);
    const sessions = readOpenCodeSessions(root);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.messages[0]).toMatchObject({
      content: "Continue the migration.\n\n[Attachment: preview.png]",
      images: [{ data: "AQID", mimeType: "image/png" }],
    });
    expect(sessions[0]?.messages[1]).toMatchObject({
      role: "assistant",
      content: "The importer is ready.",
      thinking: "Inspect the schema before writing.",
      provider: "nvidia",
      model: "z-ai/glm-5.2",
      tool_calls: [
        {
          id: "call-read",
          name: "read",
          args: { path: "src/index.ts" },
          result: "file contents",
          status: "completed",
          duration: 25,
        },
      ],
    });
    expect(sessions[1]?.title).toBe("Archived research");
  });

  test("previews and applies sessions without creating duplicate destinations", async () => {
    const written = new Map<string, OpenCodeSessionSnapshot>();
    const store: OpenCodeSessionStore = {
      exists: async (sessionId) => written.has(sessionId),
      write: async (sessionId, snapshot) => {
        written.set(sessionId, snapshot);
      },
    };
    const snapshot: OpenCodeSessionSnapshot = {
      sourceId: "ses-repeatable",
      title: "Repeatable import",
      workspaceDir: null,
      createdAt: 1_000,
      updatedAt: 2_000,
      messages: [{ role: "user", content: "Hello" }],
    };

    const preview = await migrateOpenCodeSessions([snapshot], {
      dryRun: true,
      overwrite: false,
      store,
    });
    expect(preview[0]?.status).toBe("planned");
    expect(written.size).toBe(0);

    const applied = await migrateOpenCodeSessions([snapshot], {
      dryRun: false,
      overwrite: false,
      store,
    });
    expect(applied[0]?.status).toBe("migrated");
    expect(written.size).toBe(1);

    const repeated = await migrateOpenCodeSessions([snapshot], {
      dryRun: false,
      overwrite: false,
      store,
    });
    expect(repeated[0]?.status).toBe("conflict");
    expect(written.size).toBe(1);
  });

  test("detects and previews OpenCode chats, rules, skills, commands, and JSONC config", async () => {
    const home = tempRoot("cybara-opencode-detect-");
    const configHome = join(home, "config");
    const dataHome = join(home, "data");
    const configRoot = join(configHome, "opencode");
    const dataRoot = join(dataHome, "opencode");
    const target = tempRoot("cybara-opencode-target-");
    mkdirSync(join(configRoot, "skills", "review"), { recursive: true });
    mkdirSync(join(configRoot, "commands"), { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(configRoot, "AGENTS.md"), "Use source-backed verification.\n");
    writeFileSync(
      join(configRoot, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code.\n---\n"
    );
    writeFileSync(join(configRoot, "commands", "ship.md"), "Ship verified changes.\n");
    writeFileSync(
      join(configRoot, "opencode.jsonc"),
      '{\n  // local configuration\n  "mcp": { "repo": { "type": "local" } }\n}\n'
    );
    writeFileSync(
      join(dataRoot, "auth.json"),
      JSON.stringify({ openai: { type: "api", key: "private-opencode-key" } })
    );
    createOpenCodeDatabase(dataRoot);
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.XDG_DATA_HOME = dataHome;
    try {
      const detected = detectMigrationSources().find((source) => source.kind === "opencode");
      expect(detected).toMatchObject({
        path: configRoot,
        exists: true,
        detected: { persona: true, skillCount: 2, configFiles: 2, sessionCount: 2 },
      });

      const report = await runSourceMigration(
        {
          sourceKind: "opencode",
          sourcePath: configRoot,
          preset: "full",
          dryRun: true,
        },
        { targetRoot: target, now: new Date("2026-08-01T00:00:00.000Z") }
      );
      expect(report.success).toBe(true);
      expect(report.items.filter((entry) => entry.category === "session")).toHaveLength(2);
      expect(report.items.filter((entry) => entry.category === "skill")).toHaveLength(2);
      expect(
        report.items.some((entry) => entry.category === "archive" && entry.name === "mcp")
      ).toBe(true);
      expect(JSON.stringify(report)).not.toContain("private-opencode-key");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });
});
