import { describe, expect, test } from "bun:test";
import {
  baseSubprocessEnvironment,
  buildContainerRuntimeEnvironment,
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

  test("preserves container daemon routing without provider credentials", () => {
    const environment = buildContainerRuntimeEnvironment(
      { DOCKER_CONTEXT: "workspace" },
      {
        PATH: "/bin",
        DOCKER_HOST: "tcp://127.0.0.1:2375",
        DOCKER_CONTEXT: "desktop-linux",
        CONTAINER_HOST: "unix:///run/user/1000/podman.sock",
        DOCKER_AUTH_CONFIG: "secret",
        REGISTRY_AUTH_FILE: "/tmp/secret.json",
      }
    );

    expect(environment).toEqual({
      PATH: "/bin",
      DOCKER_HOST: "tcp://127.0.0.1:2375",
      DOCKER_CONTEXT: "workspace",
      CONTAINER_HOST: "unix:///run/user/1000/podman.sock",
    });
  });
});
