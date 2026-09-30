import { describe, expect, test } from "bun:test";
import {
  classifyDecisionHttpStatus,
  decisionEndpoint,
  isLoopbackBaseUrl,
  normalizeDecisionAnswer,
  resolveDecisionConfig,
  TypesafeDecisionProvider,
} from "../../src/core/decisions/typesafe";
import { validateDecisionBatch } from "../../src/core/decisions/validation";
import { parseDecisionModelRef } from "../../src/core/decisions/registry";
describe("decision endpoint resolution", () => {
  test("appends the system one path to a bare base url", () => {
    expect(decisionEndpoint("https://api.typesafe.ai")).toBe(
      "https://api.typesafe.ai/v1/systemone"
    );
  });

  test("does not double-append the system one path", () => {
    expect(decisionEndpoint("https://api.typesafe.ai/v1/systemone")).toBe(
      "https://api.typesafe.ai/v1/systemone"
    );
  });

  test("tolerates trailing slashes", () => {
    expect(decisionEndpoint("http://127.0.0.1:8000///")).toBe("http://127.0.0.1:8000/v1/systemone");
  });

  test("recognises loopback hosts and rejects remote ones", () => {
    expect(isLoopbackBaseUrl("http://127.0.0.1:8000")).toBe(true);
    expect(isLoopbackBaseUrl("http://localhost:8000")).toBe(true);
    expect(isLoopbackBaseUrl("https://api.typesafe.ai")).toBe(false);
    expect(isLoopbackBaseUrl("not a url")).toBe(false);
  });

  test("a local system one server needs no credential", () => {
    const resolved = resolveDecisionConfig({ baseUrl: "http://127.0.0.1:8000" });
    expect(resolved.apiKey).toBeNull();
  });

  test("a hosted endpoint without a credential resolves to no key", () => {
    const resolved = resolveDecisionConfig({ baseUrl: "https://api.typesafe.ai" });
    expect(resolved.apiKey).toBeNull();
  });
});

describe("decision provider readiness", () => {
  test("is not ready with no configuration", () => {
    expect(new TypesafeDecisionProvider({}).isReady()).toBe(false);
  });

  test("is ready on a loopback endpoint with no credential", () => {
    expect(new TypesafeDecisionProvider({ baseUrl: "http://127.0.0.1:8000" }).isReady()).toBe(true);
  });

  test("is ready on a hosted endpoint with a credential", () => {
    expect(
      new TypesafeDecisionProvider({ baseUrl: "https://api.typesafe.ai", apiKey: "k" }).isReady()
    ).toBe(true);
  });

  test("is not ready on a hosted endpoint without a credential", () => {
    expect(new TypesafeDecisionProvider({ baseUrl: "https://api.typesafe.ai" }).isReady()).toBe(
      false
    );
  });
});

describe("decision http status classification", () => {
  test("maps auth failures to authentication", () => {
    expect(classifyDecisionHttpStatus(401)).toBe("authentication");
    expect(classifyDecisionHttpStatus(403)).toBe("authentication");
  });

  test("maps request-validation and oversize to unsupported input, not outage", () => {
    expect(classifyDecisionHttpStatus(422)).toBe("unsupported-input");
    expect(classifyDecisionHttpStatus(413)).toBe("unsupported-input");
  });

  test("maps throttling and overload to their own reasons", () => {
    expect(classifyDecisionHttpStatus(429)).toBe("rate-limited");
    expect(classifyDecisionHttpStatus(529)).toBe("provider-overloaded");
  });

  test("maps anything else to transport", () => {
    expect(classifyDecisionHttpStatus(500)).toBe("transport");
    expect(classifyDecisionHttpStatus(418)).toBe("transport");
  });
});

describe("decision answer normalization", () => {
  test("normalizes a noul answer and clamps its probability", () => {
    const answer = normalizeDecisionAnswer({ type: "noul", probability: 1.4, confidence: 0.5 });
    expect(answer).toEqual({ type: "noul", probability: 1, confidence: 0.5 });
  });

  test("clamps a negative probability to zero", () => {
    const answer = normalizeDecisionAnswer({ type: "noul", probability: -3 });
    expect(answer).toEqual({ type: "noul", probability: 0 });
  });

  test("normalizes a choice answer with its probability spread", () => {
    const answer = normalizeDecisionAnswer({
      type: "choice",
      choice: "urgent",
      probabilities: { urgent: 0.8, later: 0.2, bogus: "x" },
    });
    expect(answer).toEqual({
      type: "choice",
      choice: "urgent",
      probabilities: { urgent: 0.8, later: 0.2 },
    });
  });

  test("normalizes a score answer", () => {
    const answer = normalizeDecisionAnswer({ type: "score", score: "2" });
    expect(answer).toEqual({ type: "score", score: 2, probabilities: {} });
  });

  test("rejects a choice answer with no choice and a non-numeric score", () => {
    expect(normalizeDecisionAnswer({ type: "choice", probabilities: {} })).toBeNull();
    expect(normalizeDecisionAnswer({ type: "score", score: "high" })).toBeNull();
  });

  test("rejects unknown and malformed answers", () => {
    expect(normalizeDecisionAnswer({ type: "sentiment" })).toBeNull();
    expect(normalizeDecisionAnswer(null)).toBeNull();
    expect(normalizeDecisionAnswer("nope")).toBeNull();
  });
});

describe("decision batch validation", () => {
  test("accepts a well formed batch", () => {
    const result = validateDecisionBatch({
      state: "some evidence",
      questions: { urgent: { type: "noul", instructions: "Is it urgent?" } },
    });
    expect(result.ok).toBe(true);
  });

  test("an array of questions is rejected with a self describing message", () => {
    const result = validateDecisionBatch({
      state: "some evidence",
      questions: [{ type: "noul", instructions: "Is it urgent?" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("mapping question ids");
    expect(result.error).toContain("instructions");
    expect(result.error).toContain("array of questions is not accepted");
  });

  test("accepts structured state", () => {
    const result = validateDecisionBatch({
      state: [{ role: "user", content: "hi" }],
      questions: { urgent: { type: "noul", instructions: "Is it urgent?" } },
    });
    expect(result.ok).toBe(true);
  });

  test("rejects a missing state", () => {
    const result = validateDecisionBatch({
      questions: { urgent: { type: "noul", instructions: "Is it urgent?" } },
    });
    expect(result).toEqual({ ok: false, error: "state must be a string, object, or array" });
  });

  test("rejects an oversized state before any network call", () => {
    const result = validateDecisionBatch({
      state: "x".repeat(200_001),
      questions: { urgent: { type: "noul", instructions: "Is it urgent?" } },
    });
    expect(result.ok).toBe(false);
  });

  test("rejects an empty question set", () => {
    const result = validateDecisionBatch({ state: "x", questions: {} });
    expect(result).toEqual({ ok: false, error: "at least one question is required" });
  });

  test("rejects more than the question cap", () => {
    const questions: Record<string, unknown> = {};
    for (let i = 0; i < 17; i += 1) {
      questions[`q${i}`] = { type: "noul", instructions: "Is it?" };
    }
    const result = validateDecisionBatch({ state: "x", questions });
    expect(result.ok).toBe(false);
  });

  test("rejects a choice question with fewer than two options", () => {
    const result = validateDecisionBatch({
      state: "x",
      questions: { pick: { type: "choice", instructions: "Pick", options: ["only"] } },
    });
    expect(result.ok).toBe(false);
  });

  test("rejects duplicate choice options", () => {
    const result = validateDecisionBatch({
      state: "x",
      questions: { pick: { type: "choice", instructions: "Pick", options: ["a", "a"] } },
    });
    expect(result).toEqual({ ok: false, error: "pick: choice options must be unique" });
  });

  test("rejects a score question with a non-numeric legend", () => {
    const result = validateDecisionBatch({
      state: "x",
      questions: { s: { type: "score", instructions: "Rate", legend: { low: "a", high: "b" } } },
    });
    expect(result).toEqual({ ok: false, error: "s: score legend keys must be numeric" });
  });

  test("rejects an unknown question type", () => {
    const result = validateDecisionBatch({
      state: "x",
      questions: { bad: { type: "sentiment", instructions: "How does it feel?" } },
    });
    expect(result.ok).toBe(false);
  });

  test("rejects a question id that is not a safe key", () => {
    const result = validateDecisionBatch({
      state: "x",
      questions: { "a b/c": { type: "noul", instructions: "Is it?" } },
    });
    expect(result.ok).toBe(false);
  });
});

describe("decision model references", () => {
  test("splits a provider and model reference", () => {
    expect(parseDecisionModelRef("typesafe/jev-latest")).toEqual({
      providerId: "typesafe",
      model: "jev-latest",
    });
  });

  test("rejects an empty or malformed reference", () => {
    expect(parseDecisionModelRef("")).toEqual({ error: "decision model reference is empty" });
    expect(parseDecisionModelRef("jev-latest")).toEqual({
      error: "decision model must be in the form provider/model",
    });
    expect(parseDecisionModelRef("typesafe/")).toEqual({
      error: "decision model must be in the form provider/model",
    });
  });
});
