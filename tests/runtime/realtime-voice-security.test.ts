import { describe, expect, test } from "bun:test";
import { routeRequiredScope } from "../../src/api/security";

describe("realtime voice route authorization", () => {
  test("limits session minting to chat-capable clients and settings changes to managers", () => {
    expect(routeRequiredScope("POST", "/api/speech/realtime/session")).toBe("chat");
    expect(routeRequiredScope("POST", "/api/speech/realtime/test")).toBe("manage");
    expect(routeRequiredScope("PUT", "/api/speech/settings")).toBe("manage");
    expect(routeRequiredScope("POST", "/api/speech/dictate")).toBe("chat");
    expect(routeRequiredScope("POST", "/api/speech/synthesize")).toBe("chat");
    expect(routeRequiredScope("GET", "/api/speech/status")).toBe("read");
  });
});
