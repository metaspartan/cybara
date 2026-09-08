import { describe, expect, test } from "bun:test";
import {
  handleLightweightHealthRequest,
  isLightweightHealthRequest,
} from "../../src/api/health-request-handler";

describe("lightweight health request handler", () => {
  test("recognizes only supported health endpoints", () => {
    expect(isLightweightHealthRequest("GET", "/api/health")).toBe(true);
    expect(isLightweightHealthRequest("GET", "/api/health/ready")).toBe(true);
    expect(isLightweightHealthRequest("GET", "/api/providers/health")).toBe(true);
    expect(isLightweightHealthRequest("POST", "/api/health")).toBe(false);
    expect(isLightweightHealthRequest("GET", "/api/info")).toBe(false);
  });

  test("returns the complete gateway health contract", async () => {
    const response = await handleLightweightHealthRequest({
      method: "GET",
      url: "http://localhost:4269/api/health",
      headers: { host: "localhost:4269" },
      ip: "127.0.0.1",
    });
    const body = response.body as {
      product?: unknown;
      status?: unknown;
      instance_id?: unknown;
      compatibility?: {
        api_version?: unknown;
        min_client_api_version?: unknown;
        identity_version?: unknown;
      };
      checks?: { memory?: { rss?: unknown }; database?: { status?: unknown } };
    };
    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(body.product).toBe("cybara");
    expect(typeof body.instance_id).toBe("string");
    expect(String(body.instance_id)).toMatch(/^[0-9a-f-]{36}$/);
    const repeated = await handleLightweightHealthRequest({
      method: "GET",
      url: "http://localhost:4269/api/health",
      headers: { host: "localhost:4269" },
      ip: "127.0.0.1",
    });
    expect((repeated.body as { instance_id?: unknown }).instance_id).toBe(body.instance_id);
    expect(["healthy", "warning"]).toContain(body.status);
    expect(body.compatibility).toEqual({
      api_version: 1,
      min_client_api_version: 1,
      identity_version: 1,
    });
    expect(typeof body.checks?.memory?.rss).toBe("number");
    expect(body.checks?.database?.status).toBe("healthy");
  });
});
