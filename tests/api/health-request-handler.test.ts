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
      status?: unknown;
      checks?: { memory?: { rss?: unknown }; database?: { status?: unknown } };
    };
    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(["healthy", "warning"]).toContain(body.status);
    expect(typeof body.checks?.memory?.rss).toBe("number");
    expect(body.checks?.database?.status).toBe("healthy");
  });
});
