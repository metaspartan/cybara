import { afterEach, describe, expect, test } from "bun:test";
import { handleDecisionEvaluate, handleDecisionList } from "../../src/core/tools/handlers/decision";
import { TypesafeDecisionProvider } from "../../src/core/decisions/typesafe";
import {
  setStoredDecisionConfig,
  setDefaultDecisionModel,
} from "../../src/core/decisions/registry";

interface FakeServer {
  origin: string;
  stop: () => void;
  lastRequest: { path: string; auth: string | null; body: unknown } | null;
}

let active: FakeServer | null = null;

function startFakeSystemOne(
  respond: (body: unknown) => { status: number; payload: unknown }
): FakeServer {
  let lastRequest: FakeServer["lastRequest"] = null;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as unknown;
      lastRequest = {
        path: new URL(request.url).pathname,
        auth: request.headers.get("authorization"),
        body,
      };
      const result = respond(body);
      return new Response(JSON.stringify(result.payload), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  active = {
    origin: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
    get lastRequest() {
      return lastRequest;
    },
  } as FakeServer;
  return active;
}

afterEach(() => {
  active?.stop();
  active = null;
});

const NOLUL_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    is_urgent: { type: "noul", probability: 0.92, confidence: 0.88 },
  },
  usage: { input_tokens: 304, output_tokens: 18 },
};

describe("decision evaluation end to end against a local system one server", () => {
  test("evaluates a noul question and returns a probability with usage", async () => {
    const server = startFakeSystemOne(() => ({ status: 200, payload: NOLUL_RESPONSE }));
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    const result = await provider.evaluate(
      {
        state: "Help! My payouts have been failing for 3 days.",
        questions: {
          is_urgent: {
            type: "noul",
            instructions: "Does this convey urgency?",
            criteria: { true: "Explicitly time-sensitive", false: "No urgency expressed" },
          },
        },
      },
      { model: "jev-latest" }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.answers.is_urgent).toEqual({
      type: "noul",
      probability: 0.92,
      confidence: 0.88,
    });
    expect(result.usage).toEqual({ inputTokens: 304, outputTokens: 18 });
  });

  test("posts to the system one path with no auth header on loopback", async () => {
    const server = startFakeSystemOne(() => ({ status: 200, payload: NOLUL_RESPONSE }));
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    await provider.evaluate(
      { state: "x", questions: { is_urgent: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest" }
    );

    expect(server.lastRequest?.path).toBe("/v1/systemone");
    expect(server.lastRequest?.auth).toBeNull();
    expect(server.lastRequest?.body).toMatchObject({ model: "jev-latest" });
  });

  test("round trips a choice question with its full probability spread", async () => {
    const server = startFakeSystemOne(() => ({
      status: 200,
      payload: {
        model: "jev-1.13.0",
        answers: {
          route: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 0.72, infra: 0.24, other: 0.04 },
            confidence: 0.7,
          },
        },
        usage: { input_tokens: 512, output_tokens: 22 },
      },
    }));
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    const result = await provider.evaluate(
      {
        state: "customer cannot see invoices",
        questions: {
          route: {
            type: "choice",
            instructions: "Route this ticket",
            options: ["billing", "infra", "other"],
          },
        },
      },
      { model: "jev-latest" }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.answers.route).toEqual({
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.72, infra: 0.24, other: 0.04 },
      confidence: 0.7,
    });
  });

  test("round trips a score question against a legend", async () => {
    const server = startFakeSystemOne(() => ({
      status: 200,
      payload: {
        model: "jev-1.13.0",
        answers: {
          frustration: {
            type: "score",
            score: 1.05,
            legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
            probabilities: { "0": 0, "1": 0.95, "2": 0.05 },
            confidence: 0.92,
          },
        },
        usage: { input_tokens: 304, output_tokens: 18 },
      },
    }));
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    const result = await provider.evaluate(
      {
        state: "this is the third time this week",
        questions: {
          frustration: {
            type: "score",
            instructions: "How frustrated?",
            legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
          },
        },
      },
      { model: "jev-latest" }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.answers.frustration).toEqual({
      type: "score",
      score: 1.05,
      probabilities: { "0": 0, "1": 0.95, "2": 0.05 },
      confidence: 0.92,
    });
  });

  test("evaluates several questions in one batch", async () => {
    const server = startFakeSystemOne((body) => {
      const questions = (body as { questions: Record<string, unknown> }).questions;
      return {
        status: 200,
        payload: {
          model: "jev-1.13.0",
          answers: Object.fromEntries(
            Object.keys(questions).map((id) => [
              id,
              id === "pick"
                ? { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.4 } }
                : { type: "noul", probability: 0.5 },
            ])
          ),
          usage: { input_tokens: 800, output_tokens: 40 },
        },
      };
    });
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    const result = await provider.evaluate(
      {
        state: "some evidence",
        questions: {
          is_urgent: { type: "noul", instructions: "Urgent?" },
          pick: { type: "choice", instructions: "Pick", options: ["a", "b"] },
        },
      },
      { model: "jev-latest" }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(Object.keys(result.answers).sort()).toEqual(["is_urgent", "pick"]);
  });

  test("treats a 422 as unsupported input rather than an outage", async () => {
    const server = startFakeSystemOne(() => ({
      status: 422,
      payload: { error: "instructions must be a string" },
    }));
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    const result = await provider.evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest" }
    );

    expect(result).toMatchObject({ ok: false, reason: "unsupported-input" });
  });

  test("treats a 429 as rate limited and a 529 as provider overloaded", async () => {
    const throttled = startFakeSystemOne(() => ({ status: 429, payload: {} }));
    const throttledResult = await new TypesafeDecisionProvider({
      baseUrl: throttled.origin,
    }).evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest" }
    );
    expect(throttledResult).toMatchObject({ ok: false, reason: "rate-limited" });
    throttled.stop();

    const overloaded = startFakeSystemOne(() => ({ status: 529, payload: {} }));
    const overloadedResult = await new TypesafeDecisionProvider({
      baseUrl: overloaded.origin,
    }).evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest" }
    );
    expect(overloadedResult).toMatchObject({ ok: false, reason: "provider-overloaded" });
  });

  test("reports authentication failure for a rejected credential", async () => {
    const server = startFakeSystemOne(() => ({ status: 401, payload: {} }));
    const provider = new TypesafeDecisionProvider({
      baseUrl: "https://api.typesafe.ai",
      apiKey: "bad",
    });
    expect(provider.isReady()).toBe(true);
    void server;

    const result = await new TypesafeDecisionProvider({ baseUrl: server.origin }).evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest" }
    );
    expect(result).toMatchObject({ ok: false, reason: "authentication" });
  });

  test("times out a slow endpoint and reports timeout", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        await request.json();
        await Bun.sleep(400);
        return new Response("{}", { status: 200 });
      },
    });
    const provider = new TypesafeDecisionProvider({
      baseUrl: `http://127.0.0.1:${server.port}`,
    });

    const result = await provider.evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest", timeoutMs: 80 }
    );
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    server.stop(true);
  });

  test("reports cancellation when the caller aborts", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        await request.json();
        await Bun.sleep(400);
        return new Response("{}", { status: 200 });
      },
    });
    const provider = new TypesafeDecisionProvider({
      baseUrl: `http://127.0.0.1:${server.port}`,
    });
    const controller = new AbortController();
    const pending = provider.evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest", signal: controller.signal, timeoutMs: 5_000 }
    );
    setTimeout(() => controller.abort(), 40);

    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: "cancelled" });
    server.stop(true);
  });

  test("rejects a response that omits a requested answer", async () => {
    const server = startFakeSystemOne(() => ({
      status: 200,
      payload: { model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
    }));
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    const result = await provider.evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest" }
    );
    expect(result).toMatchObject({ ok: false, reason: "transport" });
  });

  test("rejects a response carrying an unsupported answer type", async () => {
    const server = startFakeSystemOne(() => ({
      status: 200,
      payload: {
        model: "jev-1.13.0",
        answers: { q: { type: "sentiment", score: 3 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }));
    const provider = new TypesafeDecisionProvider({ baseUrl: server.origin });

    const result = await provider.evaluate(
      { state: "x", questions: { q: { type: "noul", instructions: "Urgent?" } } },
      { model: "jev-latest" }
    );
    expect(result).toMatchObject({ ok: false, reason: "transport" });
  });
});

describe("decision tool surface", () => {
  test("lists decision models and the configured limits", () => {
    const listed = handleDecisionList() as {
      ok: boolean;
      models: Array<{ id: string; provider: string }>;
      limits: { maxQuestions: number };
    };
    expect(listed.ok).toBe(true);
    expect(listed.models.map((model) => model.id)).toContain("typesafe/jev-latest");
    expect(listed.models.every((model) => model.provider === "typesafe")).toBe(true);
    expect(listed.limits.maxQuestions).toBe(16);
  });

  test("returns a validation error instead of throwing on a malformed batch", async () => {
    const result = (await handleDecisionEvaluate({
      model: "typesafe/jev-latest",
      state: "x",
      questions: { bad: { type: "sentiment", instructions: "How?" } },
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("question type must be one of");
  });

  test("rejects an unknown decision model reference", async () => {
    const result = (await handleDecisionEvaluate({
      model: "typesafe/not-a-model",
      state: "x",
      questions: { q: { type: "noul", instructions: "Urgent?" } },
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown decision model");
  });

  test("reports not-configured when no decision model is selected", async () => {
    setDefaultDecisionModel("");
    const result = (await handleDecisionEvaluate({
      state: "x",
      questions: { q: { type: "noul", instructions: "Urgent?" } },
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No decision model is selected");
  });

  test("evaluates end to end through the tool against a local server", async () => {
    const server = startFakeSystemOne(() => ({ status: 200, payload: NOLUL_RESPONSE }));
    setStoredDecisionConfig({ baseUrl: server.origin });
    setDefaultDecisionModel("typesafe/jev-latest");

    const result = (await handleDecisionEvaluate({
      state: "Help! My payouts have been failing for 3 days.",
      questions: {
        is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
      },
    })) as { ok: boolean; answers: Record<string, { probability: number }> };

    expect(result.ok).toBe(true);
    expect(result.answers.is_urgent.probability).toBe(0.92);
    setDefaultDecisionModel("");
  });
});
