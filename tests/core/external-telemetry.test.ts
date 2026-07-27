import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  flushExternalTelemetry,
  getExternalTelemetrySettings,
  recordExternalMetric,
  recordExternalSpan,
  renderPrometheusMetrics,
  setExternalTelemetrySettings,
} from "../../src/core/external-telemetry";
import { isSealedSecret } from "../../src/core/secret-storage";

afterEach(() => {
  setExternalTelemetrySettings({ enabled: false, otlpEnabled: false, otlpHeaders: {} });
  config.set("external_telemetry", null);
});

describe("external telemetry", () => {
  test("seals collector headers and redacts the public settings response", () => {
    const settings = setExternalTelemetrySettings({
      enabled: true,
      otlpEnabled: true,
      otlpEndpoint: "https://collector.example.test/",
      otlpHeaders: { Authorization: "Bearer telemetry-secret" },
    });
    const stored = config.get<{ otlpHeaders: string }>("external_telemetry");

    expect(settings.otlpEndpoint).toBe("https://collector.example.test");
    expect(settings.otlpHeaders).toEqual({ Authorization: "***redacted***" });
    expect(isSealedSecret(stored?.otlpHeaders)).toBe(true);
    expect(getExternalTelemetrySettings().otlpHeaders.Authorization).toBe("***redacted***");
  });

  test("rejects unsafe endpoints and malformed header names", () => {
    expect(() => setExternalTelemetrySettings({ otlpEndpoint: "file:///tmp/traces" })).toThrow(
      "must use HTTP or HTTPS"
    );
    expect(() => setExternalTelemetrySettings({ otlpHeaders: { "Bad Header": "value" } })).toThrow(
      "Invalid telemetry header name"
    );
  });

  test("exports metrics and traces through OTLP HTTP", async () => {
    const requests: Array<{ path: string; body: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push({ path: new URL(request.url).pathname, body: await request.text() });
        return new Response(null, { status: 200 });
      },
    });

    try {
      setExternalTelemetrySettings({
        enabled: true,
        otlpEnabled: true,
        metricsEnabled: true,
        tracesEnabled: true,
        otlpEndpoint: `http://127.0.0.1:${server.port}`,
      });
      recordExternalMetric("test", "requests", 2, { route: "/health" });
      recordExternalSpan({
        name: "GET /health",
        startedAt: 100,
        endedAt: 120,
        statusCode: 200,
      });
      const status = await flushExternalTelemetry();

      expect(requests.map((request) => request.path).sort()).toEqual(["/v1/metrics", "/v1/traces"]);
      expect(requests.every((request) => request.body.includes("cybara"))).toBe(true);
      expect(status.lastError).toBeNull();
    } finally {
      server.stop(true);
    }
  });

  test("renders Prometheus counters only when explicitly enabled", () => {
    expect(() => renderPrometheusMetrics()).toThrow("disabled");
    setExternalTelemetrySettings({ enabled: true, prometheusEnabled: true });
    recordExternalMetric("tools", "success", 1);
    expect(renderPrometheusMetrics()).toContain("cybara_tools_success 1");
  });

  test("shares one in-flight export across concurrent flushes", async () => {
    let requests = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = Bun.serve({
      port: 0,
      async fetch() {
        requests += 1;
        await gate;
        return new Response(null, { status: 200 });
      },
    });

    try {
      setExternalTelemetrySettings({
        enabled: true,
        otlpEnabled: true,
        metricsEnabled: true,
        tracesEnabled: false,
        otlpEndpoint: `http://127.0.0.1:${server.port}`,
      });
      recordExternalMetric("test", "single_flight", 1);
      const first = flushExternalTelemetry();
      const second = flushExternalTelemetry();
      release?.();
      await Promise.all([first, second]);

      expect(requests).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("keeps failed export queues bounded", async () => {
    const failingServer = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 503 }),
    });
    const successServer = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 200 }),
    });

    try {
      setExternalTelemetrySettings({
        enabled: true,
        otlpEnabled: true,
        metricsEnabled: true,
        tracesEnabled: false,
        otlpEndpoint: `http://127.0.0.1:${failingServer.port}`,
      });
      for (let index = 0; index < 10_005; index += 1) {
        recordExternalMetric("test", "bounded", index);
      }
      const failed = await flushExternalTelemetry();
      expect(failed.queuedMetrics).toBe(10_000);

      setExternalTelemetrySettings({ otlpEndpoint: `http://127.0.0.1:${successServer.port}` });
      const recovered = await flushExternalTelemetry();
      expect(recovered.queuedMetrics).toBe(0);
    } finally {
      failingServer.stop(true);
      successServer.stop(true);
    }
  });
});
