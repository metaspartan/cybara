import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const providerState = {
  byId: new Map<string, Record<string, unknown>>(),
};

mock.module("../../src/core/providers", () => ({
  providers: {
    google: {
      name: "Google AI",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai",
      authType: "api_key",
      models: [
        {
          id: "gemini-3-pro-preview",
          name: "Gemini 3 Pro",
          context: 1048576,
          maxTokens: 65536,
          reasoning: false,
          input: ["text"],
        },
      ],
    },
    antigravity: {
      name: "Antigravity",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai",
      authType: "oauth",
      models: [
        {
          id: "gemini-3-pro-preview",
          name: "Gemini 3 Pro",
          context: 1048576,
          maxTokens: 65536,
          reasoning: true,
          input: ["text"],
        },
      ],
    },
  },
  resolveProviderType: (value: string) => value,
  getProviderBaseUrl: (providerType: string) =>
    providerType === "google" || providerType === "antigravity"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : "",
  getDefaultModel: (providerType: string) =>
    providerType === "google" || providerType === "antigravity"
      ? "gemini-3-pro-preview"
      : "unknown-model",
  providerManager: {
    getWithCredentials: (id: string) => providerState.byId.get(id),
    get: () => undefined,
    list: () => [],
    create: () => ({ id: "mock" }),
    update: () => true,
    delete: () => true,
    getModels: () => [],
    discoverOllamaModels: async () => [],
    getPreferredProvider: () => undefined,
    resolveProviderId: () => undefined,
    getHealthStatus: () => ({
      status: "healthy",
      summary: { total: 0, configured: 0, unconfigured: 0, withAuth: 0 },
      providers: [],
    }),
    autoCreateLocalProviders: () => undefined,
  },
}));

let handleRequest: (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; headers: Record<string, string>; body?: unknown }>;

const originalFetch = globalThis.fetch;

async function api(method: string, path: string, body?: unknown) {
  return await handleRequest({
    method,
    url: `http://localhost:4269${path}`,
    headers: { host: "localhost:4269", "sec-fetch-site": "same-origin" },
    body,
  });
}

describe("Provider test route contracts (mocked providers)", () => {
  beforeAll(() => {
    const routes = require("../../src/api/routes") as { handleRequest: typeof handleRequest };
    handleRequest = routes.handleRequest;
  });

  beforeEach(() => {
    providerState.byId.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("POST /api/providers/:id/test validates Google API-key providers against model endpoint", async () => {
    const fetchCalls: Array<{ url: string; headers: HeadersInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), headers: init?.headers || {} });
      return new Response(JSON.stringify({ name: "Gemini 3 Pro" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    providerState.byId.set("google-provider-1", {
      id: "google-provider-1",
      provider: "google",
      name: "Google",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
      api_key: "AIza-valid-key",
      access_token: null,
      refresh_token: null,
    });

    const res = await api("POST", "/api/providers/google-provider-1/test");
    expect(res.status).toBe(200);
    expect((res.body as { success?: boolean }).success).toBe(true);
    expect((res.body as { message?: string }).message).toContain("Google credentials verified");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toContain("/models/gemini-3-pro-preview");

    const headers = new Headers(fetchCalls[0]?.headers);
    expect(headers.get("x-goog-api-key")).toBe("AIza-valid-key");
    expect(headers.get("Authorization")).toBeNull();
  });

  test("POST /api/providers/:id/test uses bearer auth for OAuth-backed Google providers", async () => {
    const fetchCalls: Array<{ headers: HeadersInit }> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ headers: init?.headers || {} });
      return new Response(JSON.stringify({ name: "Gemini 3 Pro" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    providerState.byId.set("google-provider-oauth", {
      id: "google-provider-oauth",
      provider: "antigravity",
      name: "Antigravity",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
      api_key: null,
      access_token: "ya29.oauth-token",
      refresh_token: null,
    });

    const res = await api("POST", "/api/providers/google-provider-oauth/test");
    expect(res.status).toBe(200);
    expect((res.body as { success?: boolean }).success).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    const headers = new Headers(fetchCalls[0]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer ya29.oauth-token");
    expect(headers.get("x-goog-api-key")).toBeNull();
  });

  test("POST /api/providers/:id/test surfaces Google auth failures from upstream", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "API key not valid" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    providerState.byId.set("google-provider-bad", {
      id: "google-provider-bad",
      provider: "google",
      name: "Google",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
      api_key: "AIza-bad-key",
      access_token: null,
      refresh_token: null,
    });

    const res = await api("POST", "/api/providers/google-provider-bad/test");
    expect(res.status).toBe(200);
    expect((res.body as { success?: boolean }).success).toBe(false);
    expect((res.body as { message?: string }).message).toContain(
      "Google auth/model check failed: HTTP 400"
    );
  });

  test("POST /api/providers/:id/test reports malformed stored Google api_key before upstream call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("should-not-run", { status: 500 });
    }) as typeof fetch;

    providerState.byId.set("google-provider-malformed", {
      id: "google-provider-malformed",
      provider: "google",
      name: "Google",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
      api_key: "https://aistudio.google.com/apikey",
      access_token: null,
      refresh_token: null,
    });

    const res = await api("POST", "/api/providers/google-provider-malformed/test");
    expect(res.status).toBe(200);
    expect((res.body as { success?: boolean }).success).toBe(false);
    expect((res.body as { message?: string }).message).toContain(
      "Stored Google API key appears invalid"
    );
    expect(fetchCalled).toBe(false);
  });
});
