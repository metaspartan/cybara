import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  resolveGatewayLogPath,
  runGatewayForeground,
  startGatewayBackground,
} from "../../src/cli/gateway-process";

const originalHome = process.env.CYBARA_HOME;
const temporaryHomes: string[] = [];

function cybaraHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "cybara-gateway-home-"));
  temporaryHomes.push(directory);
  process.env.CYBARA_HOME = directory;
  return directory;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.CYBARA_HOME;
  else process.env.CYBARA_HOME = originalHome;
  for (const directory of temporaryHomes.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("CLI gateway process management", () => {
  test("resolves logs beneath the configured Cybara home", () => {
    const home = cybaraHome();
    const logPath = resolveGatewayLogPath();
    expect(logPath).toBe(join(home, "logs", "gateway.out.log"));
    expect(isAbsolute(logPath)).toBe(true);
    expect(relative(home, logPath)).toBe(join("logs", "gateway.out.log"));
    expect(dirname(dirname(logPath))).toBe(home);
  });

  test("background launch detaches, unreferences, and closes the parent log descriptor", () => {
    const home = cybaraHome();
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
          env: { ...process.env, CYBARA_GATEWAY_LOG_CAPTURE: "0" },
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
    expect(result.logPath).toEndWith(join("logs", "gateway.out.log"));
    expect(result.logPath).toBe(join(home, "logs", "gateway.out.log"));
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
