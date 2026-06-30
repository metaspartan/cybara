import { describe, expect, test } from "bun:test";
import {
  MOBILE_CONNECT_PROTOCOL,
  buildMobileConnectPayload,
  encodeMobileConnectPayload,
  normalizeGatewayUrl,
  parseMobileConnectPayload,
  profileFromPayload,
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
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(payload.protocol).toBe(MOBILE_CONNECT_PROTOCOL);
    const parsed = parseMobileConnectPayload(encodeMobileConnectPayload(payload));
    expect(parsed).toEqual(payload);
  });

  test("parses cybara URL payloads and creates stable profiles", () => {
    const parsed = parseMobileConnectPayload(
      "cybara://connect?name=Desk&baseUrl=http%3A%2F%2F10.0.0.4%3A4269&apiKey=cybara_key"
    );
    const profile = profileFromPayload(parsed, new Date("2026-06-30T00:00:00.000Z"));

    expect(profile.id).toBe("desk:http://10.0.0.4:4269");
    expect(profile.apiKey).toBe("cybara_key");
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
