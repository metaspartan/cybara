import { describe, expect, test } from "bun:test";
import {
  MOBILE_CONNECT_PROTOCOL,
  MOBILE_PAIRING_PROTOCOL,
  buildMobileConnectPayload,
  encodeMobileConnectPayload,
  isLoopbackGatewayUrl,
  isGatewaySessionListResponse,
  normalizeConnectionPayloadInput,
  normalizeGatewayUrl,
  parseMobileConnectPayload,
  profileFromPayload,
  resolveGatewayProfile,
  verifyGatewayProfile,
} from "../../apps/mobile/src/lib/connection";

describe("mobile gateway connection payloads", () => {
  test("normalizes gateway URLs for LAN and localhost entries", () => {
    expect(normalizeGatewayUrl("192.168.1.10:4269/")).toBe("http://192.168.1.10:4269");
    expect(normalizeGatewayUrl("https://cybara.example.com/api?x=1")).toBe(
      "https://cybara.example.com/api"
    );
    expect(isLoopbackGatewayUrl("http://127.0.0.1:4269")).toBe(true);
    expect(isLoopbackGatewayUrl("http://localhost:4269")).toBe(true);
    expect(isLoopbackGatewayUrl("http://192.168.1.10:4269")).toBe(false);
  });

  test("builds and parses QR-safe JSON payloads", () => {
    const payload = buildMobileConnectPayload({
      name: "Studio",
      baseUrl: "http://127.0.0.1:4269/",
      apiKey: "cybara_test_key",
      deviceId: "mobile_123",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(payload.protocol).toBe(MOBILE_CONNECT_PROTOCOL);
    expect(payload.deviceId).toBe("mobile_123");
    const parsed = parseMobileConnectPayload(encodeMobileConnectPayload(payload));
    expect(parsed).toEqual(payload);
  });

  test("parses cybara URL payloads and creates stable profiles", () => {
    const parsed = parseMobileConnectPayload(
      "cybara://connect?name=Desk&baseUrl=http%3A%2F%2F10.0.0.4%3A4269&apiKey=cybara_key&deviceId=mobile_456"
    );
    const profile = profileFromPayload(parsed, new Date("2026-06-30T00:00:00.000Z"));

    expect(profile.id).toBe("desk:http://10.0.0.4:4269");
    expect(profile.apiKey).toBe("cybara_key");
    expect(profile.deviceId).toBe("mobile_456");
    expect(profile.createdAt).toBe("2026-06-30T00:00:00.000Z");
  });

  test("rejects unsupported protocols and empty secrets", () => {
    expect(() => parseMobileConnectPayload('{"protocol":"other"}')).toThrow(
      "Unsupported Cybara mobile connection protocol"
    );
    expect(() => normalizeConnectionPayloadInput({})).toThrow("Connection payload must be text");
    expect(() => parseMobileConnectPayload("not a cybara payload")).toThrow(
      "Unsupported connection payload"
    );
    expect(() =>
      buildMobileConnectPayload({
        baseUrl: "http://localhost:4269",
        apiKey: " ",
      })
    ).toThrow("API key is required");
  });
});

describe("mobile gateway connection verification", () => {
  const profile = {
    id: "studio:http://192.168.1.20:4269",
    name: "Studio",
    baseUrl: "http://192.168.1.20:4269",
    apiKey: "cybara_mobile_test",
    createdAt: "2026-07-07T00:00:00.000Z",
  };

  test("checks an authenticated gateway route before storing a profile", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const okFetch: typeof fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ sessions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(verifyGatewayProfile(profile, okFetch, 0)).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        url: "http://192.168.1.20:4269/api/sessions?limit=1",
        auth: "Bearer cybara_mobile_test",
      },
    ]);
  });

  test("accepts current bare and wrapped session list contracts", () => {
    expect(isGatewaySessionListResponse([])).toBe(true);
    expect(isGatewaySessionListResponse({ sessions: [] })).toBe(true);
    expect(isGatewaySessionListResponse({ items: [] })).toBe(true);
    expect(isGatewaySessionListResponse({ status: "healthy" })).toBe(false);
    expect(isGatewaySessionListResponse("<html></html>")).toBe(false);
  });

  test("rejects successful responses that do not match the gateway contract", async () => {
    const incompatibleFetch: typeof fetch = (async () =>
      Response.json({ status: "healthy" })) as typeof fetch;

    await expect(verifyGatewayProfile(profile, incompatibleFetch, 0)).rejects.toThrow(
      "incompatible sessions response"
    );
  });

  test("reports rejected mobile tokens as a fresh-QR problem", async () => {
    const unauthorizedFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      })) as typeof fetch;

    await expect(verifyGatewayProfile(profile, unauthorizedFetch, 0)).rejects.toThrow(
      "Create a fresh QR code"
    );
  });

  test("reports unreachable LAN gateways with the local-network fix", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("Network request failed");
    }) as typeof fetch;

    await expect(verifyGatewayProfile(profile, failingFetch, 0)).rejects.toThrow("same Wi-Fi");
    await expect(verifyGatewayProfile(profile, failingFetch, 0)).rejects.toThrow(
      "Windows Firewall"
    );
    await expect(verifyGatewayProfile(profile, failingFetch, 0)).rejects.toThrow("Remote Access");
  });

  test("reports loopback QR payloads as unusable on a phone", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("Network request failed");
    }) as typeof fetch;

    await expect(
      verifyGatewayProfile({ ...profile, baseUrl: "http://127.0.0.1:4269" }, failingFetch, 0)
    ).rejects.toThrow("localhost on the phone");
  });

  test("times out authenticated verification when native fetch never resolves", async () => {
    const hangingFetch: typeof fetch = (() => new Promise<Response>(() => {})) as typeof fetch;

    await expect(verifyGatewayProfile(profile, hangingFetch, 5)).rejects.toThrow("Could not reach");
  });
});

describe("pairing-code redemption", () => {
  const okFetch: typeof fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        apiKey: `cybara_mobile_for_${body.code}`,
        device: { id: "mobile_abc" },
        payload: { name: "Studio" },
      }),
    };
  }) as unknown as typeof fetch;

  test("resolveGatewayProfile redeems a pairing-code QR into a profile", async () => {
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Studio",
      baseUrl: "http://127.0.0.1:4269",
      code: "ABCD-2345",
    });
    const profile = await resolveGatewayProfile(raw, new Date(), okFetch);
    expect(profile.apiKey).toBe("cybara_mobile_for_ABCD-2345");
    expect(profile.baseUrl).toBe("http://127.0.0.1:4269");
    expect(profile.deviceId).toBe("mobile_abc");
  });

  test("resolveGatewayProfile accepts the TestFlight LAN pairing payload shape", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          apiKey: "cybara_mobile_redeemed",
          device: { id: "mobile_real_device" },
          payload: { name: "Cybara Gateway" },
        }),
      };
    }) as unknown as typeof fetch;
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Cybara Gateway",
      baseUrl: "http://192.168.1.155:4269",
      code: "BGJ2-L5SE",
      role: "standard",
      expiresAt: 1783507769105,
    });

    const profile = await resolveGatewayProfile(
      raw,
      new Date("2026-07-08T00:00:00.000Z"),
      fetchImpl
    );

    expect(profile).toMatchObject({
      name: "Cybara Gateway",
      baseUrl: "http://192.168.1.155:4269",
      apiKey: "cybara_mobile_redeemed",
      deviceId: "mobile_real_device",
    });
    expect(calls).toEqual([
      {
        url: "http://192.168.1.155:4269/api/mobile/pair/redeem",
        body: { code: "BGJ2-L5SE" },
      },
    ]);
  });

  test("resolveGatewayProfile times out when pairing redemption never returns", async () => {
    const hangingFetch: typeof fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Studio",
      baseUrl: "http://192.168.1.20:4269",
      code: "HANG-2345",
      expiresAt: Date.now() + 60_000,
    });

    await expect(resolveGatewayProfile(raw, new Date(), hangingFetch, 5)).rejects.toThrow(
      "Could not reach"
    );
  });

  test("resolveGatewayProfile rejects expired pairing-code payloads before network use", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = ((url) => {
      calls.push(String(url));
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as typeof fetch;
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Studio",
      baseUrl: "http://192.168.1.20:4269",
      code: "OLD-2345",
      expiresAt: Date.parse("2026-07-07T20:00:00.000Z"),
    });

    await expect(
      resolveGatewayProfile(raw, new Date("2026-07-07T21:00:00.000Z"), fetchImpl, 5)
    ).rejects.toThrow("Pairing code has expired");
    expect(calls).toEqual([]);
  });

  test("resolveGatewayProfile accepts string pairing expirations from older QR payloads", async () => {
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Studio",
      baseUrl: "http://192.168.1.20:4269",
      code: "STR-2345",
      expiresAt: String(Date.parse("2026-07-07T22:00:00.000Z")),
    });
    const profile = await resolveGatewayProfile(raw, new Date("2026-07-07T21:00:00.000Z"), okFetch);
    expect(profile.apiKey).toBe("cybara_mobile_for_STR-2345");
  });

  test("resolveGatewayProfile redeems a deep-linked pairing-code payload", async () => {
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Studio",
      baseUrl: "http://192.168.1.20:4269",
      code: "LINK-2345",
    });
    const profile = await resolveGatewayProfile(
      `cybara://connect?payload=${encodeURIComponent(raw)}`,
      new Date(),
      okFetch
    );
    expect(profile.apiKey).toBe("cybara_mobile_for_LINK-2345");
    expect(profile.baseUrl).toBe("http://192.168.1.20:4269");
  });

  test("resolveGatewayProfile accepts JSON-wrapped deep link payloads", async () => {
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Studio",
      baseUrl: "http://192.168.1.20:4269",
      code: "WRAP-2345",
    });
    const profile = await resolveGatewayProfile(
      JSON.stringify({ payload: raw }),
      new Date(),
      okFetch
    );
    expect(profile.apiKey).toBe("cybara_mobile_for_WRAP-2345");
  });

  test("resolveGatewayProfile still handles a legacy direct-token QR", async () => {
    const raw = JSON.stringify({
      protocol: MOBILE_CONNECT_PROTOCOL,
      name: "Studio",
      baseUrl: "http://127.0.0.1:4269",
      apiKey: "cybara_direct",
    });
    const profile = await resolveGatewayProfile(raw);
    expect(profile.apiKey).toBe("cybara_direct");
  });

  test("a failed redemption surfaces the gateway error", async () => {
    const failFetch: typeof fetch = (async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: "Invalid, expired, or already-used pairing code",
      }),
    })) as unknown as typeof fetch;
    const raw = JSON.stringify({
      protocol: MOBILE_PAIRING_PROTOCOL,
      name: "Studio",
      baseUrl: "http://127.0.0.1:4269",
      code: "DEAD-BEEF",
    });
    await expect(resolveGatewayProfile(raw, new Date(), failFetch)).rejects.toThrow(
      /expired|already-used/
    );
  });
});
