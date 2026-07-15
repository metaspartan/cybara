import { afterEach, describe, expect, test } from "bun:test";
import {
  cursorOAuthSessionCount,
  pollCursorOAuth,
  startCursorOAuth,
} from "../../src/api/provider-oauth-cursor";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Cursor browser OAuth", () => {
  test("creates an opaque bounded login session", async () => {
    const result = await startCursorOAuth();
    expect(result.user_code).toBe("Browser login");
    expect(String(result.verification_uri)).toStartWith("https://cursor.com/loginDeepControl?");
    expect(String(result.verification_uri)).toContain("challenge=");
    expect(String(result.verification_uri)).toContain("redirectTarget=cli");
    expect(String(result.device_code)).not.toContain("verifier");
    expect(cursorOAuthSessionCount()).toBeGreaterThan(0);
  });

  test("maps pending and successful poll responses", async () => {
    const pendingLogin = await startCursorOAuth();
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect(await pollCursorOAuth(String(pendingLogin.device_code))).toEqual({ status: "pending" });

    const successLogin = await startCursorOAuth();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toStartWith("https://api2.cursor.sh/auth/poll?");
      return Response.json({ accessToken: "access", refreshToken: "refresh" });
    }) as typeof fetch;
    const result = await pollCursorOAuth(String(successLogin.device_code));
    expect(result.status).toBe("success");
    expect(result.access_token).toBe("access");
    expect(result.refresh_token).toBe("refresh");
    expect(typeof result.expires_at).toBe("number");
    expect(await pollCursorOAuth(String(successLogin.device_code))).toEqual({ status: "expired" });
  });

  test("rejects incomplete successful responses", async () => {
    const login = await startCursorOAuth();
    globalThis.fetch = (async () => Response.json({ refreshToken: "refresh" })) as typeof fetch;
    const result = await pollCursorOAuth(String(login.device_code));
    expect(result.status).toBe("error");
  });
});
