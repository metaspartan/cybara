import { afterEach, describe, expect, test } from "bun:test";
import { providerManager } from "../../src/core/providers";

const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

// ChatGPT/Codex OAuth tokens are short-lived. Without a refresh-on-use path,
// every Codex call fails once the access_token lapses. These cover the
// refresh_token exchange, expiry gating, and credential persistence.
describe("OAuth token refresh (openai-codex)", () => {
  function createCodexProvider(fields: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  }) {
    const provider = providerManager.create({
      provider: "openai-codex",
      name: "Codex OAuth Test",
      base_url: "https://chatgpt.com/backend-api",
      ...fields,
    });
    createdProviderIds.push(provider.id);
    return provider;
  }

  test("refreshes an expired token and persists the new credentials", async () => {
    const provider = createCodexProvider({
      access_token: "stale-token",
      refresh_token: "refresh-abc",
      expires_at: Date.now() - 60_000, // expired a minute ago
    });

    let tokenUrl = "";
    let sentBody = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      tokenUrl = String(input);
      sentBody = String(init?.body || "");
      return new Response(
        JSON.stringify({
          access_token: "fresh-token",
          refresh_token: "refresh-def",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );

    expect(tokenUrl).toBe("https://auth.openai.com/oauth/token");
    expect(sentBody).toContain("grant_type=refresh_token");
    expect(sentBody).toContain("refresh-abc");
    expect(refreshed?.access_token).toBe("fresh-token");
    // Persisted, so the next read sees the rotated refresh token + future expiry.
    const reread = providerManager.getWithCredentials(provider.id);
    expect(reread?.access_token).toBe("fresh-token");
    expect(reread?.refresh_token).toBe("refresh-def");
    expect(reread?.expires_at || 0).toBeGreaterThan(Date.now());
  });

  test("refreshes when expiry is unknown (never captured at auth)", async () => {
    const provider = createCodexProvider({
      access_token: "stale-token",
      refresh_token: "refresh-abc",
      // no expires_at
    });
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    expect(called).toBe(true);
    expect(refreshed?.access_token).toBe("fresh-token");
  });

  test("does NOT refresh a token that is still valid", async () => {
    const provider = createCodexProvider({
      access_token: "good-token",
      refresh_token: "refresh-abc",
      expires_at: Date.now() + 30 * 60_000, // 30 min out
    });
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const result = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    expect(called).toBe(false);
    expect(result).toBeUndefined();
  });

  test("keeps existing credentials when the refresh endpoint fails", async () => {
    const provider = createCodexProvider({
      access_token: "stale-token",
      refresh_token: "refresh-abc",
      expires_at: Date.now() - 60_000,
    });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;

    const result = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    expect(result).toBeUndefined();
    // Original token is untouched so the call can still surface a clear auth error.
    expect(providerManager.getWithCredentials(provider.id)?.access_token).toBe("stale-token");
  });

  test("backs off after a failed refresh when expiry is unknown", async () => {
    const provider = createCodexProvider({
      access_token: "stale-token",
      refresh_token: "refresh-abc",
      // unknown expiry
    });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }) as typeof fetch;

    await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    // Second call is inside the cooldown window, so the token endpoint is hit once.
    expect(calls).toBe(1);
  });

  test("is a no-op for non-oauth providers", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Plain OpenAI",
      api_key: "sk-plain",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const result = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    expect(called).toBe(false);
    expect(result).toBeUndefined();
  });

  test("refreshes Anthropic subscription tokens with a JSON request", async () => {
    const provider = providerManager.create({
      provider: "anthropic-oauth",
      name: "Anthropic OAuth Test",
      access_token: "stale-token",
      refresh_token: "refresh-token",
      expires_at: Date.now() - 1000,
    });
    createdProviderIds.push(provider.id);
    let request: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/oauth/token");
      request = init;
      return Response.json({
        access_token: "fresh-token",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
      });
    }) as typeof fetch;

    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    expect(request?.headers).toMatchObject({
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-token",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    });
    expect(refreshed?.access_token).toBe("fresh-token");
    expect(refreshed?.refresh_token).toBe("fresh-refresh");
  });

  test("refreshes Cursor tokens with bearer authentication", async () => {
    const provider = providerManager.create({
      provider: "cursor",
      name: "Cursor OAuth Test",
      access_token: "stale-token",
      refresh_token: "cursor-refresh",
      expires_at: Date.now() - 1000,
    });
    createdProviderIds.push(provider.id);
    let request: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api2.cursor.sh/auth/exchange_user_api_key");
      request = init;
      return Response.json({ accessToken: "fresh-token", refreshToken: "fresh-refresh" });
    }) as typeof fetch;

    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    expect(request?.headers).toMatchObject({ Authorization: "Bearer cursor-refresh" });
    expect(request?.body).toBe("{}");
    expect(refreshed?.access_token).toBe("fresh-token");
    expect(refreshed?.refresh_token).toBe("fresh-refresh");
  });

  test("refreshes Grok OAuth without widening scope and retries one transient failure", async () => {
    const provider = providerManager.create({
      provider: "xai-oauth",
      name: "Grok OAuth Test",
      access_token: "stale-token",
      refresh_token: "grok-refresh",
      expires_at: Date.now() - 1000,
    });
    createdProviderIds.push(provider.id);
    const bodies: string[] = [];
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://auth.x.ai/oauth2/token");
      calls += 1;
      bodies.push(String(init?.body || ""));
      if (calls === 1) {
        return Response.json(
          { error: "temporarily_unavailable" },
          { status: 429, headers: { "Retry-After": "0" } }
        );
      }
      return Response.json({
        access_token: "fresh-grok-token",
        refresh_token: "fresh-grok-refresh",
        expires_in: 3600,
      });
    }) as typeof fetch;

    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );

    expect(calls).toBe(2);
    expect(bodies[0]).toContain("grant_type=refresh_token");
    expect(bodies[0]).toContain("refresh_token=grok-refresh");
    expect(bodies[0]).toContain("client_id=b1a00492-073a-47ea-816f-4c329264a828");
    expect(bodies[0]).not.toContain("scope=");
    expect(refreshed?.access_token).toBe("fresh-grok-token");
    expect(refreshed?.refresh_token).toBe("fresh-grok-refresh");
  });

  test("refreshes MiniMax Portal tokens with the current client and scope", async () => {
    const provider = providerManager.create({
      provider: "minimax-portal",
      name: "MiniMax Portal OAuth Test",
      access_token: "stale-token",
      refresh_token: "minimax-refresh",
      expires_at: Date.now() - 1000,
    });
    createdProviderIds.push(provider.id);
    let request: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://account.minimax.io/oauth2/token");
      request = init;
      return Response.json({
        access_token: "fresh-minimax-token",
        refresh_token: "fresh-minimax-refresh",
        expires_in: 3600,
      });
    }) as typeof fetch;

    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    const body = new URLSearchParams(String(request?.body || ""));

    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("minimax-refresh");
    expect(body.get("client_id")).toBe("659cf4c1-615c-45f6-a5f6-4bf15eb476e5");
    expect(body.get("scope")).toBe("openid profile coding_plan");
    expect(refreshed?.access_token).toBe("fresh-minimax-token");
    expect(refreshed?.refresh_token).toBe("fresh-minimax-refresh");
  });

  test("refreshes Kimi coding-plan tokens with stable device identity", async () => {
    const provider = providerManager.create({
      provider: "kimi-code-oauth",
      name: "Kimi Code OAuth Test",
      access_token: "stale-kimi-token",
      refresh_token: "kimi-refresh",
      expires_at: Date.now() - 1000,
    });
    createdProviderIds.push(provider.id);
    let request: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://auth.kimi.com/api/oauth/token");
      request = init;
      return Response.json({
        access_token: "fresh-kimi-token",
        refresh_token: "fresh-kimi-refresh",
        expires_in: 3600,
      });
    }) as typeof fetch;

    const refreshed = await providerManager.refreshOAuthCredentialsIfNeeded(
      providerManager.getWithCredentials(provider.id)
    );
    const body = new URLSearchParams(String(request?.body || ""));
    const headers = new Headers(request?.headers);

    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("kimi-refresh");
    expect(body.get("client_id")).toBe("17e5f671-d194-4dfb-9706-5516cb48c098");
    expect(body.has("scope")).toBe(false);
    expect(headers.get("User-Agent")).toMatch(/^Cybara\//);
    expect(headers.get("X-Msh-Platform")).toBe("kimi_code_cli");
    expect(headers.get("X-Msh-Device-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(refreshed?.access_token).toBe("fresh-kimi-token");
    expect(refreshed?.refresh_token).toBe("fresh-kimi-refresh");
  });
});
