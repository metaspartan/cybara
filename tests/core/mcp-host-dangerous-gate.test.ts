import { afterEach, describe, expect, test } from "bun:test";
import { hostAllowsDangerousTools } from "../../src/core/mcp-host-server";

const KEY = "CYBARA_MCP_HOST_ALLOW_DANGEROUS";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("MCP host dangerous-tool gate", () => {
  test("defaults to OFF — a reachable client does not get unattended shell", () => {
    delete process.env[KEY];
    expect(hostAllowsDangerousTools()).toBe(false);
  });

  test("only enabled by an explicit opt-in", () => {
    process.env[KEY] = "1";
    expect(hostAllowsDangerousTools()).toBe(true);
    process.env[KEY] = "true";
    expect(hostAllowsDangerousTools()).toBe(true);
    process.env[KEY] = "yes";
    expect(hostAllowsDangerousTools()).toBe(false);
    process.env[KEY] = "0";
    expect(hostAllowsDangerousTools()).toBe(false);
  });
});
