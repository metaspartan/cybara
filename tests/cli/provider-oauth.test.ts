import { describe, expect, test } from "bun:test";
import { connectCliProviderOAuth } from "../../src/cli/commands/provider-oauth";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CLI provider OAuth", () => {
  test("completes device-code authorization and returns refresh credentials", async () => {
    const requests: string[] = [];
    const opened: string[] = [];
    const verification: { code?: string; url: string }[] = [];
    let now = 1_000;
    let polls = 0;
    const credentials = await connectCliProviderOAuth({
      apiBase: "http://127.0.0.1:4269",
      providerType: "minimax-portal",
      oauthFlow: "device_code",
      headers: () => ({ "Content-Type": "application/json", Authorization: "Bearer test" }),
      fetchImpl: (async (input) => {
        requests.push(String(input));
        if (String(input).endsWith("/device-code")) {
          return jsonResponse({
            device_code: "session-id",
            user_code: "ABCD-EFGH",
            verification_uri: "https://platform.minimax.io/device",
            expires_in: 60,
            interval: 1,
          });
        }
        polls += 1;
        return polls === 1
          ? jsonResponse({ status: "pending" })
          : jsonResponse({
              status: "success",
              access_token: "access",
              refresh_token: "refresh",
              expires_at: 123_456,
            });
      }) as typeof fetch,
      openExternal: (url) => opened.push(url),
      onVerification: (value) => verification.push(value),
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
      minimumPollIntervalMs: 0,
    });

    expect(credentials).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 123_456,
    });
    expect(requests).toEqual([
      "http://127.0.0.1:4269/api/providers/oauth/device-code",
      "http://127.0.0.1:4269/api/providers/oauth/poll",
      "http://127.0.0.1:4269/api/providers/oauth/poll",
    ]);
    expect(opened).toEqual(["https://platform.minimax.io/device"]);
    expect(verification).toEqual([
      { code: "ABCD-EFGH", url: "https://platform.minimax.io/device" },
    ]);
  });

  test("completes redirect authorization and tolerates callback throttling", async () => {
    let now = 1_000;
    let polls = 0;
    const pollBodies: unknown[] = [];
    const credentials = await connectCliProviderOAuth({
      apiBase: "http://127.0.0.1:4269",
      providerType: "openai-codex",
      oauthFlow: "redirect",
      headers: () => ({ "Content-Type": "application/json" }),
      fetchImpl: (async (input, init) => {
        if (String(input).endsWith("/start")) {
          return jsonResponse({
            auth_url: "https://auth.openai.com/authorize",
            state: "oauth-state",
            poll_token: "oauth-poll-token",
          });
        }
        pollBodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
        polls += 1;
        return polls === 1
          ? jsonResponse({ error: "slow down" }, 429)
          : jsonResponse({ status: "success", access_token: "access" });
      }) as typeof fetch,
      openExternal: () => undefined,
      onVerification: () => undefined,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
      minimumPollIntervalMs: 0,
    });

    expect(credentials).toEqual({
      accessToken: "access",
      refreshToken: undefined,
      expiresAt: undefined,
    });
    expect(polls).toBe(2);
    expect(pollBodies).toEqual([
      { state: "oauth-state", poll_token: "oauth-poll-token" },
      { state: "oauth-state", poll_token: "oauth-poll-token" },
    ]);
  });

  test("rejects incomplete authorization responses", async () => {
    await expect(
      connectCliProviderOAuth({
        apiBase: "http://127.0.0.1:4269",
        providerType: "minimax-portal",
        oauthFlow: "device_code",
        headers: () => ({}),
        fetchImpl: (async () => jsonResponse({ user_code: "missing-device-code" })) as typeof fetch,
        openExternal: () => undefined,
        onVerification: () => undefined,
      })
    ).rejects.toThrow("incomplete authorization response");
  });
});
