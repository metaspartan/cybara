import { describe, expect, test } from "bun:test";
import {
  getOpenCommandForPlatform,
  openUrlInBrowser,
  type SpawnLike,
} from "../../src/core/runtime/open-url";

describe("open-url runtime helper", () => {
  test("getOpenCommandForPlatform maps darwin correctly", () => {
    const cmd = getOpenCommandForPlatform("darwin", "https://example.com");
    expect(cmd.command).toBe("open");
    expect(cmd.args).toEqual(["https://example.com"]);
    expect(cmd.options.detached).toBe(true);
  });

  test("getOpenCommandForPlatform maps win32 correctly", () => {
    const cmd = getOpenCommandForPlatform("win32", "https://example.com");
    expect(cmd.command).toBe("cmd");
    expect(cmd.args).toEqual(["/c", "start", "", "https://example.com"]);
    expect(cmd.options.windowsHide).toBe(true);
  });

  test("getOpenCommandForPlatform maps linux/other to xdg-open", () => {
    const cmd = getOpenCommandForPlatform("linux", "https://example.com");
    expect(cmd.command).toBe("xdg-open");
    expect(cmd.args).toEqual(["https://example.com"]);
    expect(cmd.options.detached).toBe(true);
  });

  test("openUrlInBrowser invokes spawn with mapped command and unrefs child", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: Record<string, unknown>;
    }> = [];
    let unrefCount = 0;

    const spawnFn: SpawnLike = (command, args, options) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      return {
        unref: () => {
          unrefCount += 1;
        },
      };
    };

    await openUrlInBrowser("https://example.com/docs", {
      platform: "darwin",
      spawnFn,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("open");
    expect(calls[0].args).toEqual(["https://example.com/docs"]);
    expect(unrefCount).toBe(1);
  });
});
