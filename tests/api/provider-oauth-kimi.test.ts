import { afterEach, describe, expect, test } from "bun:test";
import {
  pollProviderDeviceCodeOAuth,
  startProviderDeviceCodeOAuth,
} from "../../src/api/provider-oauth-device";

const originalFetch = globalThis.fetch;

describe("Kimi coding-plan OAuth", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("uses the official device form, token form, and identity headers", async () => {
    const requests: Array<{ url: string; body: URLSearchParams; headers: Headers }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: new URLSearchParams(String(init?.body || "")),
        headers: new Headers(init?.headers),
      });
      if (String(input).endsWith("device_authorization")) {
        return Response.json({
          device_code: "kimi-device-code",
          user_code: "KIMI-CODE",
          verification_uri: "https://www.kimi.com/code/device",
          verification_uri_complete: "https://www.kimi.com/code/device?user_code=KIMI-CODE",
          expires_in: 600,
          interval: 5,
        });
      }
      return Response.json({
        access_token: "kimi-access-token",
        refresh_token: "kimi-refresh-token",
        expires_in: 3600,
      });
    }) as typeof fetch;

    const start = await startProviderDeviceCodeOAuth({ providerType: "kimi-code-oauth" });
    const poll = await pollProviderDeviceCodeOAuth({
      providerType: "kimi-code-oauth",
      deviceCode: "kimi-device-code",
    });

    expect(start).toMatchObject({
      user_code: "KIMI-CODE",
      verification_uri_complete: "https://www.kimi.com/code/device?user_code=KIMI-CODE",
    });
    expect(poll).toMatchObject({
      status: "success",
      access_token: "kimi-access-token",
      refresh_token: "kimi-refresh-token",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://auth.kimi.com/api/oauth/device_authorization",
      "https://auth.kimi.com/api/oauth/token",
    ]);
    expect(requests[0]?.body.get("client_id")).toBe("17e5f671-d194-4dfb-9706-5516cb48c098");
    expect(requests[0]?.body.has("scope")).toBe(false);
    expect(requests[1]?.body.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code"
    );
    expect(requests[0]?.headers.get("User-Agent")).toMatch(/^Cybara\//);
    expect(requests[0]?.headers.get("X-Msh-Platform")).toBe("kimi_code_cli");
    expect(requests[0]?.headers.get("X-Msh-Device-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("rejects untrusted verification URLs", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        device_code: "kimi-device-code",
        user_code: "KIMI-CODE",
        verification_uri: "https://attacker.example/verify",
        verification_uri_complete: "https://attacker.example/verify?user_code=KIMI-CODE",
        expires_in: 600,
        interval: 5,
      })) as typeof fetch;

    expect(startProviderDeviceCodeOAuth({ providerType: "kimi-code-oauth" })).rejects.toThrow(
      "Kimi OAuth returned an untrusted complete device verification URI"
    );
  });

  test("requires a refresh token", async () => {
    globalThis.fetch = (async () =>
      Response.json({ access_token: "kimi-access-token", expires_in: 3600 })) as typeof fetch;

    const response = await pollProviderDeviceCodeOAuth({
      providerType: "kimi-code-oauth",
      deviceCode: "kimi-device-code",
    });

    expect(response).toEqual({
      status: "error",
      error:
        "Kimi OAuth did not return a refresh token. Re-run login and authorize the coding-plan account again.",
    });
  });
});
