import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { countSourceSessions, readSourceSessions } from "../../src/core/source-migration-sessions";

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
            message: { role: "assistant", content: [{ type: "text", text: "hi back" }] },
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
      JSON.stringify({ type: "session", id: "oc-1", cwd: root, timestamp: "2026-03-01T00:00:00Z" }),
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
});
