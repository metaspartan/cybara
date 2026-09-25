import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, sep } from "path";
import { countSourceSessions, readSourceSessions } from "../../src/core/source-migration-sessions";
import {
  migrateOpenCodeSessions,
  type OpenCodeSessionSnapshot,
  type OpenCodeSessionStore,
} from "../../src/core/source-migration-opencode";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cybara-mig-sessions-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("source session import", () => {
  test("reads Claude Code transcripts and keys each file separately", () => {
    const root = makeRoot();
    const projects = join(root, "projects", "demo");
    mkdirSync(projects, { recursive: true });
    const shared = { sessionId: "shared-session-id", cwd: root };
    for (const name of ["a.jsonl", "b.jsonl"]) {
      writeFileSync(
        join(projects, name),
        [
          JSON.stringify({
            ...shared,
            type: "user",
            timestamp: "2026-01-01T00:00:00Z",
            message: { role: "user", content: `hello from ${name}` },
          }),
          JSON.stringify({
            ...shared,
            type: "assistant",
            timestamp: "2026-01-01T00:01:00Z",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hi back" }],
            },
          }),
        ].join("\n")
      );
    }
    const sessions = readSourceSessions("claude-code", root);
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((s) => s.sourceId)).size).toBe(2);
    expect(sessions[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(countSourceSessions("claude-code", root)).toBe(2);
  });

  test("drops a workspace directory that no longer exists", () => {
    const root = makeRoot();
    const projects = join(root, "projects");
    mkdirSync(projects, { recursive: true });
    writeFileSync(
      join(projects, "gone.jsonl"),
      [
        JSON.stringify({
          type: "user",
          cwd: join(root, "deleted-worktree"),
          timestamp: "2026-01-01T00:00:00Z",
          message: { role: "user", content: "still import me" },
        }),
      ].join("\n")
    );
    const sessions = readSourceSessions("claude-code", root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].workspaceDir).toBeNull();
  });

  test("reads Codex rollout transcripts", () => {
    const root = makeRoot();
    const dir = join(root, "sessions", "2026");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "rollout.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-02-01T00:00:00Z",
          payload: { id: "codex-1", cwd: root },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-02-01T00:00:01Z",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "codex question" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-02-01T00:00:02Z",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "codex answer" }],
          },
        }),
      ].join("\n")
    );
    const sessions = readSourceSessions("codex", root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages).toHaveLength(2);
    expect(sessions[0].workspaceDir).toBe(root);
  });

  test("reads OpenClaw sessions and skips trajectory and deleted files", () => {
    const root = makeRoot();
    const dir = join(root, "agents", "main", "sessions");
    mkdirSync(dir, { recursive: true });
    const body = [
      JSON.stringify({
        type: "session",
        id: "oc-1",
        cwd: root,
        timestamp: "2026-03-01T00:00:00Z",
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-03-01T00:00:01Z",
        message: { role: "user", content: "openclaw prompt" },
      }),
    ].join("\n");
    writeFileSync(join(dir, "s1.jsonl"), body);
    writeFileSync(join(dir, "s1.trajectory.jsonl"), body);
    writeFileSync(join(dir, "s2.jsonl.deleted.2026.jsonl"), body);
    const sessions = readSourceSessions("openclaw", root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages[0].content).toBe("openclaw prompt");
  });

  test("reads Hermes session json", () => {
    const root = makeRoot();
    const dir = join(root, "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "session_20260101_abc.json"),
      JSON.stringify({
        session_id: "hermes-1",
        session_start: "2026-01-01T00:00:00Z",
        last_updated: "2026-01-01T01:00:00Z",
        messages: [
          { role: "user", content: "hermes prompt" },
          { role: "assistant", content: "hermes reply" },
          { role: "system", content: "ignored" },
        ],
      })
    );
    const sessions = readSourceSessions("hermes", root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("returns nothing for sources without transcripts", () => {
    const root = makeRoot();
    expect(readSourceSessions("opencode", root)).toEqual([]);
    expect(countSourceSessions("codex", root)).toBe(0);
  });
  test("finds transcripts when the source path is already the transcript directory", () => {
    const root = makeRoot();
    const projects = join(root, "projects", "demo");
    mkdirSync(projects, { recursive: true });
    writeFileSync(
      join(projects, "a.jsonl"),
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "hello" },
      })
    );
    expect(readSourceSessions("claude-code", root)).toHaveLength(1);
    expect(readSourceSessions("claude-code", join(root, "projects"))).toHaveLength(1);
    expect(countSourceSessions("claude-code", join(root, "projects"))).toBe(1);
  });

  test("excludes nested and legacy Claude Code subagent transcripts", () => {
    const root = makeRoot();
    const projects = join(root, "projects", "demo");
    const nested = join(projects, "11111111-2222-3333-4444-555555555555", "subagents");
    mkdirSync(nested, { recursive: true });
    const subagentRow = JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "subagent task" },
    });
    writeFileSync(join(nested, "agent-aaaaaaaaaaaaaaaa.jsonl"), subagentRow);
    writeFileSync(join(projects, "agent-bbbbbbbbbbbbbbbb.jsonl"), subagentRow);
    writeFileSync(
      join(projects, "root-session.jsonl"),
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "root conversation" },
      })
    );
    const sessions = readSourceSessions("claude-code", root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages[0]?.content).toBe("root conversation");
    expect(countSourceSessions("claude-code", root)).toBe(1);
  });

  test("skips sidechain rows inside a Claude Code transcript", () => {
    const root = makeRoot();
    const projects = join(root, "projects", "demo");
    mkdirSync(projects, { recursive: true });
    writeFileSync(
      join(projects, "session.jsonl"),
      [
        JSON.stringify({
          type: "user",
          isSidechain: false,
          timestamp: "2026-01-01T00:00:00Z",
          message: { role: "user", content: "root question" },
        }),
        JSON.stringify({
          type: "user",
          isSidechain: true,
          timestamp: "2026-01-01T00:00:01Z",
          message: { role: "user", content: "sidechain prompt" },
        }),
        JSON.stringify({
          type: "assistant",
          isSidechain: true,
          timestamp: "2026-01-01T00:00:02Z",
          message: { role: "assistant", content: "sidechain answer" },
        }),
        JSON.stringify({
          type: "assistant",
          isSidechain: false,
          timestamp: "2026-01-01T00:00:03Z",
          message: { role: "assistant", content: "root answer" },
        }),
      ].join("\n")
    );
    const sessions = readSourceSessions("claude-code", root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages.map((m) => m.content)).toEqual(["root question", "root answer"]);
  });

  test("does not count or import sidechain-only or malformed root transcripts", () => {
    const root = makeRoot();
    const projects = join(root, "projects", "demo");
    mkdirSync(projects, { recursive: true });
    writeFileSync(
      join(projects, "renamed.jsonl"),
      JSON.stringify({
        type: "user",
        isSidechain: true,
        message: { role: "user", content: "delegated task" },
      })
    );
    writeFileSync(join(projects, "empty.jsonl"), "");
    writeFileSync(join(projects, "malformed.jsonl"), "not-json");
    expect(readSourceSessions("claude-code", root)).toEqual([]);
    expect(countSourceSessions("claude-code", root)).toBe(0);
  });

  test("prefers explicit Claude Code titles over first user message", () => {
    const root = makeRoot();
    const projects = join(root, "projects", "demo");
    mkdirSync(projects, { recursive: true });
    const row = (extra: Record<string, unknown>) =>
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "user",
          content: "first user prompt that should not win",
        },
        ...extra,
      });
    writeFileSync(
      join(projects, "custom.jsonl"),
      `${row({})}\n${JSON.stringify({ type: "custom-title", customTitle: "Custom title" })}\n${JSON.stringify({ type: "ai-title", aiTitle: "AI title" })}`
    );
    writeFileSync(
      join(projects, "ai.jsonl"),
      `${row({})}\n${JSON.stringify({ type: "ai-title", aiTitle: "AI title" })}`
    );
    writeFileSync(join(projects, "none.jsonl"), row({}));
    const sessions = readSourceSessions("claude-code", root);
    expect(sessions).toHaveLength(3);
    const bySource = new Map(
      sessions.map((session) => [session.sourceId.split(sep).pop(), session])
    );
    expect(bySource.get("custom.jsonl")?.title).toBe("Custom title");
    expect(bySource.get("ai.jsonl")?.title).toBe("AI title");
    expect(bySource.get("none.jsonl")?.title).toBe("first user prompt that should not win");
  });

  test("imports shared-session Claude Code transcripts independently and idempotently", async () => {
    const root = makeRoot();
    const projects = join(root, "projects", "demo");
    mkdirSync(projects, { recursive: true });
    for (const name of ["one.jsonl", "two.jsonl"]) {
      writeFileSync(
        join(projects, name),
        JSON.stringify({
          sessionId: "same-session",
          type: "user",
          timestamp: "2026-01-01T00:00:00Z",
          message: { role: "user", content: `chat ${name}` },
        })
      );
    }
    const written = new Map<string, OpenCodeSessionSnapshot>();
    const store: OpenCodeSessionStore = {
      exists: async (sessionId) => written.has(sessionId),
      write: async (sessionId, snapshot) => {
        written.set(sessionId, snapshot);
      },
    };
    const options = { dryRun: false, overwrite: false, store };
    const first = await migrateOpenCodeSessions(readSourceSessions("claude-code", root), options);
    expect(first.map((result) => result.status)).toEqual(["migrated", "migrated"]);
    expect(written.size).toBe(2);
    expect(new Set(first.map((result) => result.sessionId)).size).toBe(2);
    const second = await migrateOpenCodeSessions(readSourceSessions("claude-code", root), options);
    expect(second.map((result) => result.status)).toEqual(["conflict", "conflict"]);
    expect(written.size).toBe(2);
  });
});
