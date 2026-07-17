import { afterEach, describe, expect, test } from "bun:test";
import {
  resolveGatewayLogPath,
  runGatewayForeground,
  startGatewayBackground,
} from "../../src/cli/gateway-process";

const originalHome = process.env.CYBARA_HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.CYBARA_HOME;
  else process.env.CYBARA_HOME = originalHome;
});

describe("CLI gateway process management", () => {
  test("resolves logs beneath the configured Cybara home", () => {
    process.env.CYBARA_HOME = "/tmp/cybara-process-test";
    expect(resolveGatewayLogPath()).toBe("/tmp/cybara-process-test/logs/gateway.out.log");
  });

  test("background launch detaches, unreferences, and closes the parent log descriptor", () => {
    process.env.CYBARA_HOME = "/tmp/cybara-process-test";
    let unreferenced = false;
    let closedDescriptor = -1;
    let receivedCommand: string[] = [];
    const result = startGatewayBackground({
      openLog: () => 42,
      closeLog: (descriptor) => {
        closedDescriptor = descriptor;
      },
      spawn: (command, options) => {
        receivedCommand = command;
        expect(options).toEqual({
          stdin: "ignore",
          stdout: 42,
          stderr: 42,
          detached: true,
        });
        return {
          pid: 731,
          exited: Promise.resolve(0),
          unref: () => {
            unreferenced = true;
          },
        };
      },
    });

    expect(receivedCommand).toEqual(["bun", "run", "dev"]);
    expect(result.pid).toBe(731);
    expect(result.logPath).toEndWith("/logs/gateway.out.log");
    expect(unreferenced).toBe(true);
    expect(closedDescriptor).toBe(42);
  });

  test("foreground launch returns the child exit code", async () => {
    const exitCode = await runGatewayForeground({
      spawn: (command, options) => {
        expect(command).toEqual(["bun", "run", "dev"]);
        expect(options).toEqual({ stdin: "inherit", stdout: "inherit", stderr: "inherit" });
        return { pid: 732, exited: Promise.resolve(17), unref: () => undefined };
      },
    });

    expect(exitCode).toBe(17);
  });
});
