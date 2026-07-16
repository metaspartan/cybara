import { describe, expect, test } from "bun:test";
import {
  isGatewayReady,
  resolveGatewayHealthStatus,
  resolveProviderConfigurationStatus,
} from "../../src/api/health-status";

describe("gateway health status", () => {
  test("fails health and readiness closed when the database is unavailable", () => {
    expect(resolveGatewayHealthStatus("unhealthy", "healthy")).toBe("unhealthy");
    expect(isGatewayReady("unhealthy")).toBe(false);
  });

  test("preserves measured resource status when the database is available", () => {
    expect(resolveGatewayHealthStatus("healthy", "healthy")).toBe("healthy");
    expect(resolveGatewayHealthStatus("healthy", "warning")).toBe("warning");
    expect(resolveGatewayHealthStatus("healthy", "critical")).toBe("critical");
    expect(isGatewayReady("healthy")).toBe(true);
  });

  test("labels provider records as configuration rather than live health", () => {
    expect(resolveProviderConfigurationStatus(0, 0)).toBe("empty");
    expect(resolveProviderConfigurationStatus(3, 3)).toBe("configured");
    expect(resolveProviderConfigurationStatus(3, 2)).toBe("incomplete");
  });
});
