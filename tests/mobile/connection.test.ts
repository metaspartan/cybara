import { describe, expect, test } from "bun:test";
import {
  MOBILE_CONNECT_PROTOCOL,
  MOBILE_PAIRING_PROTOCOL,
  buildMobileConnectPayload,
  encodeMobileConnectPayload,
  normalizeGatewayUrl,
  parseMobileConnectPayload,
  profileFromPayload,
  resolveGatewayProfile,
} from "../../apps/mobile/src/lib/connection";

describe("mobile gateway connection payloads", () => {
  test("normalizes gateway URLs for LAN and localhost entries", () => {
    expect(normalizeGatewayUrl("192.168.1.10:4269/")).toBe("http://192.168.1.10:4269");
    expect(normalizeGatewayUrl("https://cybara.example.com/api?x=1")).toBe(
      "https://cybara.example.com/api"
    );
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
    expect(() =>
      buildMobileConnectPayload({ baseUrl: "http://localhost:4269", apiKey: " " })
    ).toThrow("API key is required");
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
