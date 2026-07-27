import { describe, expect, test } from "bun:test";
import {
  anthropicEndpointPath,
  anthropicRequestBase,
  anthropicRequestHeaders,
  VERTEX_ANTHROPIC_VERSION,
} from "../../src/core/llm/anthropic-vertex";
import { providers } from "../../src/core/providers";

describe("anthropic vertex request shaping", () => {
  test("endpoint path differs for vertex vs direct", () => {
    expect(anthropicEndpointPath("claude-sonnet-4-5@20250929", false)).toBe("/messages");
    expect(anthropicEndpointPath("claude-sonnet-4-5@20250929", true)).toBe(
      "/claude-sonnet-4-5@20250929:rawPredict"
    );
  });

  test("vertex body drops model and adds anthropic_version", () => {
    const body = anthropicRequestBase("claude-opus-4-1@20250805", [{ role: "user" }], 4096, true);
    expect(body.model).toBeUndefined();
    expect(body.anthropic_version).toBe(VERTEX_ANTHROPIC_VERSION);
    expect(body.max_tokens).toBe(4096);
  });

  test("direct body keeps model and omits anthropic_version", () => {
    const body = anthropicRequestBase("claude-opus-4-8", [{ role: "user" }], 4096, false);
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.anthropic_version).toBeUndefined();
  });

  test("vertex uses Bearer auth; direct uses x-api-key", () => {
    const v = anthropicRequestHeaders("gcp-token", true);
    expect(v.Authorization).toBe("Bearer gcp-token");
    expect(v["x-api-key"]).toBeUndefined();
    expect(v["anthropic-version"]).toBeUndefined();

    const d = anthropicRequestHeaders("sk-ant", false);
    expect(d["x-api-key"]).toBe("sk-ant");
    expect(d["anthropic-version"]).toBe("2023-06-01");
    expect(d.Authorization).toBeUndefined();
  });

  test("subscription OAuth uses Bearer auth and the OAuth beta", () => {
    const headers = anthropicRequestHeaders("oauth-token", false, true);
    expect(headers.Authorization).toBe("Bearer oauth-token");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
  });
});

describe("vertex provider entries", () => {
  test("anthropic_vertex uses the anthropic-vertex api family", () => {
    const p = providers.anthropic_vertex as { api?: string; authType?: string; baseUrl?: string };
    expect(p.api).toBe("anthropic-vertex");
    expect(p.authType).toBe("api_key");
    expect(p.baseUrl).toContain("aiplatform.googleapis.com");
    expect(p.baseUrl).toContain("publishers/anthropic/models");
    expect(providers.anthropic_vertex.models.map((model) => model.id)).toEqual([
      "claude-opus-5@default",
      "claude-sonnet-5@default",
    ]);
  });

  test("google_vertex uses the google-vertex api family with a publishers/google base", () => {
    const p = providers.google_vertex as { api?: string; authType?: string; baseUrl?: string };
    expect(p.api).toBe("google-vertex");
    expect(p.authType).toBe("api_key");
    expect(p.baseUrl).toContain("aiplatform.googleapis.com");
    expect(p.baseUrl).toContain("publishers/google");
    expect(providers.google_vertex.models.map((model) => model.id)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ]);
  });

  test("bedrock exposes only current models supported by its Converse transport", () => {
    const modelIds = providers.bedrock.models.map((model) => model.id);
    expect(modelIds).toEqual([
      "anthropic.claude-opus-4-8",
      "anthropic.claude-fable-5",
      "anthropic.claude-sonnet-5",
    ]);
    expect(modelIds).not.toContain("anthropic.claude-opus-5");
  });
});
