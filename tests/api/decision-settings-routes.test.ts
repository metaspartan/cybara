import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import db from "../../src/core/database";
import { decisionRoutes, decisionSettingsResponse } from "../../src/api/routes/decisions";
import {
  getDefaultDecisionModel,
  getStoredDecisionConfig,
} from "../../src/core/decisions/registry";

const CONFIG_KEY = "decisions.typesafe";
const MODEL_KEY = "decisions.defaultModel";
const SECRET = "tsk-live-do-not-leak-1234567890";

function clearDecisionConfig(): void {
  db.prepare("DELETE FROM config WHERE key IN (?, ?)").run(CONFIG_KEY, MODEL_KEY);
}

function putRoute(body: unknown): Record<string, unknown> {
  const handler = decisionRoutes["PUT /api/settings/decisions"];
  if (!handler) throw new Error("PUT route is not registered");
  return handler(body) as Record<string, unknown>;
}

interface Rejection {
  status: number;
  body: string;
}

function putExpectingRejection(body: unknown): Rejection {
  const handler = decisionRoutes["PUT /api/settings/decisions"];
  if (!handler) throw new Error("PUT route is not registered");
  const result = handler(body) as Record<string, unknown> & { body: string; status: number };
  expect(result.status).toBe(400);
  return { status: result.status, body: String(result.body) };
}

describe("decision settings routes", () => {
  beforeEach(() => {
    clearDecisionConfig();
  });

  afterEach(() => {
    clearDecisionConfig();
  });

  test("GET and PUT are both registered", () => {
    expect(decisionRoutes["GET /api/settings/decisions"]).toBeDefined();
    expect(decisionRoutes["PUT /api/settings/decisions"]).toBeDefined();
  });

  test("GET reports defaults when nothing is configured", () => {
    const result = decisionSettingsResponse();
    expect(result.base_url).toBe("");
    expect(result.has_api_key).toBe(false);
    expect(result.model).toBe("");
    expect(result.provider_ready).toBe(false);
    expect(Array.isArray(result.models)).toBe(true);
    expect((result.models as unknown[]).length).toBeGreaterThan(0);
  });

  test("PUT never echoes the API key back in the response", () => {
    const response = putRoute({ api_key: SECRET, model: "typesafe/jev-latest" });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(SECRET);
    expect(response.has_api_key).toBe(true);
  });

  test("GET never returns the API key in plaintext", () => {
    putRoute({ api_key: SECRET });
    const serialized = JSON.stringify(decisionSettingsResponse());
    expect(serialized).not.toContain(SECRET);
  });

  test("stores the API key encrypted at rest and round-trips it", () => {
    putRoute({ api_key: SECRET });
    const raw = config.get<{ apiKey?: string }>(CONFIG_KEY);
    expect(raw?.apiKey).toBeTruthy();
    expect(raw?.apiKey).not.toBe(SECRET);
    expect(raw?.apiKey?.startsWith("cybara-secret:")).toBe(true);
    expect(getStoredDecisionConfig().apiKey).toBe(SECRET);
  });

  test("persists a known decision model", () => {
    putRoute({ model: "typesafe/kev-latest" });
    expect(getDefaultDecisionModel()).toBe("typesafe/kev-latest");
  });

  test("accepts clearing the model back to disabled", () => {
    putRoute({ model: "typesafe/jev-latest" });
    putRoute({ model: "" });
    expect(getDefaultDecisionModel()).toBe("");
  });

  test("rejects an unknown model with 400", () => {
    const rejection = putExpectingRejection({ model: "typesafe/not-a-model" });
    expect(rejection.body).toContain("Unknown decision model");
  });

  test("rejects a model without a provider prefix with 400", () => {
    const rejection = putExpectingRejection({ model: "jev-latest" });
    expect(rejection.body).toContain("provider/model");
  });

  test("rejects non-string field types with 400", () => {
    expect(putExpectingRejection({ api_key: 42 }).body).toContain("api_key must be a string");
    expect(putExpectingRejection({ base_url: { evil: true } }).body).toContain(
      "base_url must be a string"
    );
    expect(putExpectingRejection({ model: 7 }).body).toContain("model must be a string");
  });

  test("rejection body does not leak the submitted api key", () => {
    const rejection = putExpectingRejection({ api_key: 42, model: "bogus" });
    expect(rejection.body).not.toContain(SECRET);
  });

  test("omitting the api key preserves the stored one", () => {
    putRoute({ api_key: SECRET });
    putRoute({ model: "typesafe/jev-latest" });
    expect(getStoredDecisionConfig().apiKey).toBe(SECRET);
  });

  test("normalizes a blank api key and endpoint", () => {
    putRoute({ api_key: "   ", base_url: "  " });
    expect(getStoredDecisionConfig().apiKey).toBeUndefined();
    expect(getStoredDecisionConfig().baseUrl).toBeUndefined();
  });

  test("clears a stored api key when the field is blanked", () => {
    putRoute({ api_key: SECRET });
    expect(getStoredDecisionConfig().apiKey).toBe(SECRET);
    const response = putRoute({ api_key: "" });
    expect(getStoredDecisionConfig().apiKey).toBeUndefined();
    expect(response.has_api_key).toBe(false);
  });

  test("clears a stored api key when the field is nulled", () => {
    putRoute({ api_key: SECRET });
    putRoute({ api_key: null });
    expect(getStoredDecisionConfig().apiKey).toBeUndefined();
  });

  test("clears a stored endpoint without disturbing the api key", () => {
    putRoute({ api_key: SECRET, base_url: "https://api.typesafe.ai/v1/systemone" });
    putRoute({ base_url: "" });
    expect(getStoredDecisionConfig().baseUrl).toBeUndefined();
    expect(getStoredDecisionConfig().apiKey).toBe(SECRET);
  });

  test("a cleared key leaves no sealed secret behind at rest", () => {
    putRoute({ api_key: SECRET });
    putRoute({ api_key: "" });
    const raw = config.get<{ apiKey?: string }>(CONFIG_KEY);
    expect(raw?.apiKey ?? "").not.toContain("cybara-secret:");
  });

  test("reports provider readiness as false for a malformed stored model ref", () => {
    db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(MODEL_KEY, "broken-ref");
    const result = decisionSettingsResponse();
    expect(result.provider_ready).toBe(false);
    expect(result.model).toBe("broken-ref");
  });

  test("rejects a bad model before writing any other field", () => {
    putExpectingRejection({ base_url: "http://localhost:1234", model: "bogus" });
    expect(getStoredDecisionConfig().baseUrl).toBeUndefined();
    expect(getDefaultDecisionModel()).toBe("");
  });

  test("clears a stored api key when explicitly nulled", () => {
    putRoute({ api_key: SECRET });
    expect(getStoredDecisionConfig().apiKey).toBe(SECRET);
    putRoute({ api_key: null });
    expect(getStoredDecisionConfig().apiKey).toBeUndefined();
  });

  test("reports provider readiness for a loopback endpoint with no key", () => {
    putRoute({ base_url: "http://127.0.0.1:8787/v1/systemone", model: "typesafe/jev-latest" });
    const result = decisionSettingsResponse();
    expect(result.provider_ready).toBe(true);
    expect(result.has_api_key).toBe(false);
  });
});
