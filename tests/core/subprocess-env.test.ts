import { describe, expect, test } from "bun:test";
import {
  baseSubprocessEnvironment,
  buildSubprocessEnvironment,
} from "../../src/core/subprocess-env";

describe("subprocess environment", () => {
  test("keeps runtime variables and removes provider credentials", () => {
    const environment = baseSubprocessEnvironment({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "secret",
      ANTHROPIC_AUTH_TOKEN: "secret",
      CYBARA_API_KEY: "secret",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LANG: "en_US.UTF-8",
    });
  });

  test("adds only explicit child overrides", () => {
    const environment = buildSubprocessEnvironment(
      { MCP_TOKEN: "scoped", EMPTY: undefined },
      { PATH: "/bin", PROVIDER_SECRET: "hidden" }
    );

    expect(environment).toEqual({ PATH: "/bin", MCP_TOKEN: "scoped" });
  });
});
