import { expect, test } from "bun:test";
import { normalizeXiaomiEndpoint } from "../../src/core/providers/xiaomi-endpoint";
import { postAnthropicMessages } from "../../src/core/llm/anthropic-sdk-transport";

test("normalizes documented MiMo endpoints without changing the selected region", async () => {
  for (const host of ["api", "token-plan-cn", "token-plan-sgp", "token-plan-ams"]) {
    for (const suffix of ["", "/", "/v1"]) {
      const base = normalizeXiaomiEndpoint(`https://${host}.xiaomimimo.com/anthropic${suffix}`);
      let requestedUrl = "";
      const transport = (async (input, init) => {
        requestedUrl = String(input);
        expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
        return Response.json({ type: "message" });
      }) as typeof fetch;
      const response = await postAnthropicMessages(
        base,
        "/messages",
        {
          method: "POST",
          headers: { "x-api-key": "test-key" },
          body: JSON.stringify({ model: "mimo-v2.6-pro", messages: [] }),
        },
        transport
      );
      expect(response.status).toBe(200);
      expect(requestedUrl).toBe(`https://${host}.xiaomimimo.com/anthropic/v1/messages`);
    }
  }
});

test("preserves custom endpoints and never reroutes credentials to another host", () => {
  for (const url of [
    "https://proxy.example/anthropic",
    "https://api.xiaomimimo.com.evil.example/anthropic",
    "http://api.xiaomimimo.com/anthropic",
    "https://api.xiaomimimo.com/anthropic?custom=true",
    "not-a-url",
  ]) {
    expect(normalizeXiaomiEndpoint(url)).toBe(url);
  }
});
