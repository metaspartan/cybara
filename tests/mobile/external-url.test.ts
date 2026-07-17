import { describe, expect, test } from "bun:test";
import { isAllowedExternalUrl } from "../../apps/mobile/src/lib/externalUrlPolicy";

describe("mobile external URL policy", () => {
  test("allows supported web and communication links", () => {
    expect(isAllowedExternalUrl("https://cybara.ai/docs")).toBe(true);
    expect(isAllowedExternalUrl("http://192.168.1.16:8123")).toBe(true);
    expect(isAllowedExternalUrl("mailto:hello@cybara.ai")).toBe(true);
    expect(isAllowedExternalUrl("tel:+12085550100")).toBe(true);
  });

  test("rejects executable, local-file, data, and malformed links", () => {
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html;base64,PGgxPkJhZDwvaDE+")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });
});
