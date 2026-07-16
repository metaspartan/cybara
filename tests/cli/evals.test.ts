import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvalCommand } from "../../src/cli/commands/evals";

const originalLog = console.log;
const originalError = console.error;

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  process.exitCode = 0;
});

describe("CLI eval commands", () => {
  test("prints stored percentage scores without scaling them again", async () => {
    const lines: string[] = [];
    console.log = (...values: unknown[]) => lines.push(values.map(String).join(" "));
    await runEvalCommand(
      ["list"],
      async <T>(): Promise<T | null> =>
        ({
          goldens: [
            {
              id: "golden-1",
              name: "Repository review",
              baseline: { model: "model-1", structure: { tools: [] } },
            },
          ],
          runs: [
            {
              goldenId: "golden-1",
              status: "failed",
              score: 75,
              replaySessionId: "session-1",
            },
          ],
        }) as T
    );
    expect(lines).toContain("  latest: failed 75%");
    expect(lines.join("\n")).not.toContain("7500%");
  });

  test("exports sanitized JSONL through the shared gateway route", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-cli-evals-"));
    const output = join(directory, "evals.jsonl");
    const requests: Array<{ endpoint: string; options?: RequestInit }> = [];
    console.log = () => undefined;
    try {
      await runEvalCommand(
        ["export", "--format", "jsonl", "--sanitize", "--output", output],
        async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
          requests.push({ endpoint, options });
          return {
            filename: "evals.jsonl",
            mimeType: "application/x-ndjson",
            content: '{"trajectory":1}',
            count: 1,
          } as T;
        }
      );
      expect(requests).toEqual([
        { endpoint: "/api/evals/export?format=jsonl&sanitize=1", options: undefined },
      ]);
      expect(await Bun.file(output).text()).toBe('{"trajectory":1}');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("imports a suite without creating a terminal-only data path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-cli-evals-"));
    const input = join(directory, "suite.json");
    await Bun.write(input, JSON.stringify({ format: "cybara-agent-eval-suite", version: 1 }));
    let requestBody = "";
    console.log = () => undefined;
    try {
      await runEvalCommand(
        ["import", input],
        async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
          expect(endpoint).toBe("/api/evals/import");
          requestBody = String(options?.body || "");
          return { success: true, count: 1 } as T;
        }
      );
      expect(JSON.parse(requestBody)).toEqual({
        bundle: { format: "cybara-agent-eval-suite", version: 1 },
      });
      expect(process.exitCode).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
