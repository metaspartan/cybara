import { describe, expect, test } from "bun:test";
import {
  createWebSocketAuthProtocol,
  parseWebSocketAuthProtocol,
} from "../../shared/websocket-auth";

describe("websocket auth protocol", () => {
  test("round trips API and gateway credentials without exposing plaintext", () => {
    const protocol = createWebSocketAuthProtocol({
      token: "api-secret",
      password: "gateway-secret",
    });

    expect(protocol).not.toBeNull();
    expect(protocol).not.toContain("api-secret");
    expect(protocol).not.toContain("gateway-secret");
    expect(parseWebSocketAuthProtocol(protocol)).toEqual({
      protocol,
      token: "api-secret",
      password: "gateway-secret",
    });
  });

  test("rejects empty, malformed, and oversized protocols", () => {
    expect(createWebSocketAuthProtocol({})).toBeNull();
    expect(parseWebSocketAuthProtocol("chat, cybara.auth.invalid")).toBeNull();
    expect(parseWebSocketAuthProtocol(`cybara.auth.${"a".repeat(20_000)}`)).toBeNull();
  });
});
