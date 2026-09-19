import { describe, expect, test } from "bun:test";
import {
  describeProviderConnectionFailure,
  formatLlmFailure,
} from "../../src/core/agent-error-format";

const bunConnectError = new TypeError("Was there a typo in the url or port?");

describe("provider connection failures", () => {
  test("points macOS users at Local Network access for a LAN provider", () => {
    const message = formatLlmFailure(bunConnectError, {
      providerName: "DGX Spark",
      baseUrl: "http://192.168.1.149:8888/v1",
      platform: "darwin",
    });
    expect(message).toContain("Couldn't connect to DGX Spark at 192.168.1.149:8888");
    expect(message).toContain("System Settings → Privacy & Security → Local Network");
    expect(message).not.toContain("typo");
  });

  test("recognises the common local network address forms", () => {
    for (const baseUrl of [
      "http://10.0.0.5:8000/v1",
      "http://172.20.1.2/v1",
      "http://dgx.local:8888/v1",
      "http://spark:8888/v1",
      "http://100.101.102.103:8888/v1",
      "http://[fd12::1]:8888/v1",
    ]) {
      expect(
        describeProviderConnectionFailure("ECONNREFUSED", { baseUrl, platform: "darwin" })
      ).toContain("Local Network");
    }
  });

  test("gives a plain reachability hint off macOS, for internet hosts, and for loopback", () => {
    for (const [baseUrl, platform] of [
      ["http://192.168.1.149:8888/v1", "linux"],
      ["https://api.example.com/v1", "darwin"],
      ["http://127.0.0.1:11434", "darwin"],
      ["http://localhost:1234/v1", "darwin"],
    ] as const) {
      const message = describeProviderConnectionFailure("Unable to connect", {
        baseUrl,
        providerName: "Local",
        platform,
      });
      expect(message).toContain("Couldn't connect to Local");
      expect(message).toContain("Check that the server is running");
      expect(message).not.toContain("Local Network");
    }
  });

  test("leaves other failures and missing base URLs to the existing messages", () => {
    expect(
      describeProviderConnectionFailure("API error: 401 - unauthorized", {
        baseUrl: "http://192.168.1.149:8888/v1",
        platform: "darwin",
      })
    ).toBeUndefined();
    expect(describeProviderConnectionFailure(bunConnectError.message, {})).toBeUndefined();
    expect(
      formatLlmFailure(new Error("API error: 401 - bad key"), { baseUrl: "http://10.0.0.2" })
    ).toContain("authentication failed (401)");
  });
});
