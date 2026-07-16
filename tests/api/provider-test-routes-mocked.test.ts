import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
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
    elevenlabs: {
      name: "ElevenLabs",
      baseUrl: "https://api.elevenlabs.io/v1",
      api: "elevenlabs-speech",
      authType: "api_key",
      models: [
        {
          id: "eleven_multilingual_v2",
          name: "Eleven Multilingual v2",
          context: 5000,
          maxTokens: 5000,
          reasoning: false,
          input: ["text"],
        },
      ],
    },
    "xai-oauth": {
      name: "xAI Grok OAuth",
      baseUrl: "https://cli-chat-proxy.grok.com/v1",
      api: "xai-grok-responses",
      authType: "oauth",
      oauthFlow: "device_code",
      oauthConfig: {
        clientId: "b1a00492-073a-47ea-816f-4c329264a828",
        discoveryUrl: "https://auth.x.ai/.well-known/openid-configuration",
        deviceCodeDiscoveryUrl: "https://auth.x.ai/.well-known/openid-configuration",
        tokenUrl: "https://auth.x.ai/oauth2/token",
        scope:
          "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
      },
      models: [
        {
          id: "grok-build-0.1",
          name: "Grok Build 0.1",
          context: 256000,
          maxTokens: 64000,
          reasoning: true,
          input: ["text", "image"],
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
}) => Promise<{
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}>;

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
    const routes = require("../../src/api/routes") as {
      handleRequest: typeof handleRequest;
    };
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

  test("POST /api/providers/:id/test validates ElevenLabs providers against voices endpoint", async () => {
    const fetchCalls: Array<{ url: string; headers: HeadersInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), headers: init?.headers || {} });
      return new Response(JSON.stringify({ voices: [{ voice_id: "voice-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    providerState.byId.set("eleven-provider-1", {
      id: "eleven-provider-1",
      provider: "elevenlabs",
      name: "ElevenLabs",
      base_url: "https://api.elevenlabs.io/v1",
      api_key: "eleven-test-key",
      access_token: null,
      refresh_token: null,
    });

    const res = await api("POST", "/api/providers/eleven-provider-1/test");
    expect(res.status).toBe(200);
    expect((res.body as { success?: boolean }).success).toBe(true);
    expect((res.body as { message?: string }).message).toContain("ElevenLabs credentials verified");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://api.elevenlabs.io/v1/voices");

    const headers = new Headers(fetchCalls[0]?.headers);
    expect(headers.get("xi-api-key")).toBe("eleven-test-key");
  });

  test("POST /api/providers/oauth/device-code discovers xAI endpoints and returns complete verification URI", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrls.push(String(input));
      if (String(input) === "https://auth.x.ai/.well-known/openid-configuration") {
        return Response.json({
          device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
          token_endpoint: "https://auth.x.ai/oauth2/token",
        });
      }
      expect(String(input)).toBe("https://auth.x.ai/oauth2/device/code");
      const body = init?.body as URLSearchParams;
      const headers = new Headers(init?.headers);
      expect(body.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
      expect(body.get("scope")).toContain("grok-cli:access");
      expect(body.get("scope")).toContain("conversations:read");
      expect(body.get("scope")).toContain("conversations:write");
      expect(body.get("referrer")).toBe("grok-build");
      expect(headers.get("x-grok-client-surface")).toBe("ui");
      expect(headers.get("x-grok-client-version")).toMatch(/^\d+\.\d+\.\d+/);
      return Response.json({
        device_code: "device-123",
        user_code: "ABCD-1234",
        verification_uri: "https://x.ai/device",
        verification_uri_complete: "https://x.ai/device?user_code=ABCD-1234",
        expires_in: 900,
        interval: 5,
      });
    }) as typeof fetch;

    const res = await api("POST", "/api/providers/oauth/device-code", {
      providerType: "xai-oauth",
    });

    expect(res.status).toBe(200);
    expect(seenUrls).toEqual([
      "https://auth.x.ai/.well-known/openid-configuration",
      "https://auth.x.ai/oauth2/device/code",
    ]);
    expect((res.body as { verification_uri_complete?: string }).verification_uri_complete).toBe(
      "https://x.ai/device?user_code=ABCD-1234"
    );
  });

  test("POST /api/providers/oauth/poll maps pending and success statuses for xAI", async () => {
    const responses = [
      Response.json({
        device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
        token_endpoint: "https://auth.x.ai/oauth2/token",
      }),
      Response.json({ error: "authorization_pending" }, { status: 400 }),
      Response.json({
        device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
        token_endpoint: "https://auth.x.ai/oauth2/token",
      }),
      Response.json({
        access_token: "xai-access-token",
        refresh_token: "xai-refresh-token",
        expires_in: 3600,
      }),
    ];
    const seenTokenBodies: URLSearchParams[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://auth.x.ai/oauth2/token") {
        seenTokenBodies.push(init?.body as URLSearchParams);
      }
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch ${String(input)}`);
      return next;
    }) as typeof fetch;

    const pending = await api("POST", "/api/providers/oauth/poll", {
      providerType: "xai-oauth",
      deviceCode: "device-123",
    });
    const success = await api("POST", "/api/providers/oauth/poll", {
      providerType: "xai-oauth",
      deviceCode: "device-456",
    });

    expect(pending.body).toEqual({ status: "pending" });
    expect((success.body as { status?: string }).status).toBe("success");
    expect((success.body as { access_token?: string }).access_token).toBe("xai-access-token");
    expect((success.body as { refresh_token?: string }).refresh_token).toBe("xai-refresh-token");
    expect(typeof (success.body as { expires_at?: unknown }).expires_at).toBe("number");
    expect(seenTokenBodies[0]?.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code"
    );
    expect(seenTokenBodies[1]?.get("device_code")).toBe("device-456");
  });

  test("MiniMax OAuth uses the current PKCE device authorization contract", async () => {
    let verifier = "";
    let challenge = "";
    let userCode = "";
    let tokenGrant = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body as URLSearchParams;
      if (url.endsWith("/oauth2/device/code")) {
        challenge = body.get("code_challenge") || "";
        const state = body.get("state") || "";
        expect(body.get("client_id")).toBe("659cf4c1-615c-45f6-a5f6-4bf15eb476e5");
        expect(body.get("scope")).toBe("openid profile coding_plan");
        expect(body.get("response_type")).toBeNull();
        expect(body.get("code_challenge_method")).toBe("S256");
        return Response.json({
          user_code: "MINI-MAX",
          verification_uri: "https://platform.minimax.io/device",
          expired_in: Date.now() + 600_000,
          interval: 2000,
          state,
        });
      }
      expect(url).toBe("https://account.minimax.io/oauth2/token");
      verifier = body.get("code_verifier") || "";
      userCode = body.get("user_code") || "";
      tokenGrant = body.get("grant_type") || "";
      return Response.json({
        status: "success",
        access_token: "minimax-access",
        refresh_token: "minimax-refresh",
        expired_in: 3600,
      });
    }) as typeof fetch;

    const start = await api("POST", "/api/providers/oauth/device-code", {
      providerType: "minimax-portal",
    });
    const startBody = start.body as { device_code?: string; interval?: number };
    expect(start.status).toBe(200);
    expect(startBody.interval).toBe(2);
    expect(challenge).toHaveLength(43);

    const poll = await api("POST", "/api/providers/oauth/poll", {
      providerType: "minimax-portal",
      deviceCode: startBody.device_code,
    });
    expect(poll.status).toBe(200);
    expect(poll.body).toMatchObject({
      status: "success",
      access_token: "minimax-access",
      refresh_token: "minimax-refresh",
    });
    expect(userCode).toBe("MINI-MAX");
    expect(tokenGrant).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });

  test("MiniMax OAuth rejects an untrusted verification host", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      return Response.json({
        user_code: "MINI-MAX",
        verification_uri: "https://attacker.example/device",
        expired_in: Date.now() + 600_000,
        interval: 2000,
        state: body.get("state"),
      });
    }) as typeof fetch;

    const response = await api("POST", "/api/providers/oauth/device-code", {
      providerType: "minimax-portal",
    });
    expect(response.status).toBe(400);
    expect((response.body as { error?: string }).error).toContain(
      "MiniMax returned an invalid authorization response"
    );
  });

  test("MiniMax OAuth uses regional hosts for China portal accounts", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seenUrls.push(url);
      const body = init?.body as URLSearchParams;
      if (url.endsWith("/oauth2/device/code")) {
        return Response.json({
          user_code: "MINI-CN",
          verification_uri: "https://platform.minimaxi.com/device",
          expired_in: Date.now() + 600_000,
          interval: 2000,
          state: body.get("state"),
        });
      }
      return Response.json({
        status: "success",
        access_token: "minimax-cn-access",
        refresh_token: "minimax-cn-refresh",
        expired_in: 3600,
        resource_url: "https://api.minimaxi.com",
      });
    }) as typeof fetch;

    const start = await api("POST", "/api/providers/oauth/device-code", {
      providerType: "minimax-portal-cn",
    });
    const deviceCode = (start.body as { device_code?: string }).device_code;
    const poll = await api("POST", "/api/providers/oauth/poll", {
      providerType: "minimax-portal-cn",
      deviceCode,
    });

    expect(start.status).toBe(200);
    expect(poll.status).toBe(200);
    expect(seenUrls).toEqual([
      "https://account.minimaxi.com/oauth2/device/code",
      "https://account.minimaxi.com/oauth2/token",
    ]);
    expect((poll.body as { resource_url?: string }).resource_url).toBe("https://api.minimaxi.com/");
  });

  test("POST /api/providers/oauth/device-code rejects untrusted xAI discovery endpoints", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        device_authorization_endpoint: "https://evil.example/oauth/device",
        token_endpoint: "https://auth.x.ai/oauth2/token",
      })) as typeof fetch;

    const res = await api("POST", "/api/providers/oauth/device-code", {
      providerType: "xai-oauth",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toContain(
      "xAI OAuth discovery returned an untrusted device authorization endpoint"
    );
  });

  test("POST /api/providers/oauth/poll requires xAI refresh tokens", async () => {
    const responses = [
      Response.json({
        device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
        token_endpoint: "https://auth.x.ai/oauth2/token",
      }),
      Response.json({
        access_token: "xai-access-token",
        expires_in: 3600,
      }),
    ];
    globalThis.fetch = (async () => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      return next;
    }) as typeof fetch;

    const res = await api("POST", "/api/providers/oauth/poll", {
      providerType: "xai-oauth",
      deviceCode: "device-no-refresh",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "error",
      error:
        "xAI OAuth did not return a refresh token. Re-run login; if it keeps happening, xAI rejected offline_access for this OAuth client.",
    });
  });
});
