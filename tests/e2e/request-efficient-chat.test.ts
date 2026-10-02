import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RequestBody {
  tools?: unknown[];
  messages?: Array<{ role: string; content?: string }>;
}

test("memory-disabled chats keep useful local titles without auxiliary requests and retain an explicit title opt-in", async () => {
  const home = mkdtempSync(join(tmpdir(), "cybara-request-contract-"));
  const key = "request-contract-fixture";
  const recorded: RequestBody[] = [];
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return Response.json({ data: [{ id: "fixture-model" }] });
      const body = (await request.json()) as RequestBody;
      recorded.push(body);
      const title =
        body.messages?.[0]?.content?.includes("session title") ||
        body.messages?.at(-1)?.content?.includes("Generate the best session title");
      return Response.json({
        id: `fixture-${recorded.length}`,
        object: "chat.completion",
        model: "fixture-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: title
                ? "Readable model title"
                : "This is a substantive completed answer with durable-looking project context that would previously trigger an unwanted memory-review request despite the explicitly memory-disabled agent. The caller-visible answer is retained in full without shortening the model output. ".repeat(
                    2
                  ),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
    },
  });
  const slot = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const base = `http://127.0.0.1:${slot.port}`;
  slot.stop(true);
  const gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: join(home, "Local"),
      PORT: new URL(base).port,
      CYBARA_HOST: "127.0.0.1",
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const api = async (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST"
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = (await response.json()) as Record<string, unknown>;
    expect(response.ok).toBe(true);
    expect(value.error).toBeUndefined();
    expect(value.failure).toBeUndefined();
    return value;
  };
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    await api("/api/setup/complete", {});
    const p = await api("/api/providers", {
      provider: "llamacpp",
      name: "Request-contract provider",
      base_url: `http://127.0.0.1:${provider.port}/v1`,
    });
    const agent = await api("/api/agents", {
      name: "Request-contract agent",
      model: "fixture-model",
      provider_id: p.id,
      memory_enabled: false,
    });
    const sessionId = `request-contract-${crypto.randomUUID()}`;
    await api("/api/chat", {
      agentId: agent.id,
      sessionId,
      message: "Explain this fixture without changing files",
      tools: false,
      stream: false,
    });

    await Bun.sleep(400);
    expect(recorded).toHaveLength(1);
    const session = await api(`/api/chat/sessions/${sessionId}`);
    expect(session.title).toBe("Explain this fixture without changing files");
    const messages = session.messages as Array<{ role: string; content: string }>;
    expect(messages.at(-1)?.content.length).toBeGreaterThan(400);
    await api("/api/config", { session_title_model_enabled: true }, "PUT");
    await api("/api/chat", {
      agentId: agent.id,
      sessionId: `request-opt-in-${crypto.randomUUID()}`,
      message: "Generate a useful opt-in title",
      tools: false,
      stream: false,
    });
    for (let attempt = 0; attempt < 50 && recorded.length < 3; attempt += 1) await Bun.sleep(20);
    expect(recorded).toHaveLength(3);
    expect(
      recorded.filter((body) =>
        body.messages?.at(-1)?.content?.includes("Generate the best session title")
      )
    ).toHaveLength(1);
  } finally {
    gateway.kill();
    await gateway.exited;
    provider.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 40_000);
