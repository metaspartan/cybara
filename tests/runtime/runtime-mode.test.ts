import { describe, expect, test } from "bun:test";
import {
  isCompiledRuntime,
  isGatewayNetworkExposed,
  isHostedRuntime,
  isLoopbackHostName,
  isProductionRuntime,
} from "../../src/core/runtime/runtime-mode";

describe("runtime mode", () => {
  test("recognizes Bun source runtimes across platforms", () => {
    expect(isCompiledRuntime("/Users/test/.bun/bin/bun")).toBe(false);
    expect(isCompiledRuntime("C:\\Users\\test\\.bun\\bin\\bun.exe")).toBe(false);
  });

  test("recognizes installed standalone executables", () => {
    expect(isCompiledRuntime("/users/ck/.local/bin/cybara")).toBe(true);
    expect(isCompiledRuntime("C:\\Program Files\\Cybara\\cybara.exe")).toBe(true);
  });

  test("treats compiled and explicitly production runtimes as production", () => {
    expect(isProductionRuntime({ execPath: "/users/ck/.local/bin/cybara", nodeEnv: "" })).toBe(
      true
    );
    expect(isProductionRuntime({ execPath: "/usr/local/bin/bun", nodeEnv: "production" })).toBe(
      true
    );
    expect(isProductionRuntime({ execPath: "/usr/local/bin/bun", nodeEnv: "development" })).toBe(
      false
    );
  });

  test("treats only explicit NODE_ENV=production as hosted, not compiled CLI binaries", () => {
    expect(isHostedRuntime({ nodeEnv: "production" })).toBe(true);
    expect(isHostedRuntime({ nodeEnv: "" })).toBe(false);
    expect(isHostedRuntime({ nodeEnv: "development" })).toBe(false);
  });

  test("recognizes loopback host names", () => {
    expect(isLoopbackHostName("127.0.0.1")).toBe(true);
    expect(isLoopbackHostName("localhost")).toBe(true);
    expect(isLoopbackHostName("::1")).toBe(true);
    expect(isLoopbackHostName("[::1]")).toBe(true);
    expect(isLoopbackHostName("0.0.0.0")).toBe(false);
    expect(isLoopbackHostName("192.168.1.10")).toBe(false);
  });

  test("flags network-exposed gateways from host env and expose flag", () => {
    expect(isGatewayNetworkExposed({ env: { CYBARA_RUNTIME_HOST: "0.0.0.0" }, argv: [] })).toBe(
      true
    );
    expect(isGatewayNetworkExposed({ env: { CYBARA_HOST: "192.168.1.10" }, argv: [] })).toBe(true);
    expect(isGatewayNetworkExposed({ env: { CYBARA_RUNTIME_HOST: "127.0.0.1" }, argv: [] })).toBe(
      false
    );
    expect(isGatewayNetworkExposed({ env: { CYBARA_RUNTIME_HOST: "localhost" }, argv: [] })).toBe(
      false
    );
    expect(isGatewayNetworkExposed({ env: {}, argv: ["cybara", "start", "--expose"] })).toBe(true);
    expect(isGatewayNetworkExposed({ env: {}, argv: ["cybara", "start"] })).toBe(false);
  });
});
