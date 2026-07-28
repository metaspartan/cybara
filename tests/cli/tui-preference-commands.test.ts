import { describe, expect, test } from "bun:test";
import { runTuiPreferenceCommand } from "../../src/cli/tui/tui-preference-commands";

describe("TUI preference commands", () => {
  test("reports current preferences without writing config", async () => {
    let calls = 0;
    const result = await runTuiPreferenceCommand({
      argument: "show",
      command: "scroll",
      fetchAPI: async () => {
        calls += 1;
        return null;
      },
      mouseScrolling: true,
      scrollStep: 3,
    });
    expect(result).toEqual({
      handled: true,
      notice: "Transcript wheel step: 3 messages.",
    });
    expect(calls).toBe(0);
  });

  test("persists valid scroll and mouse changes", async () => {
    const bodies: string[] = [];
    const fetchAPI = async <T>(_endpoint: string, options?: RequestInit): Promise<T | null> => {
      bodies.push(String(options?.body || ""));
      return { success: true } as T;
    };
    const scroll = await runTuiPreferenceCommand({
      argument: "5",
      command: "scroll",
      fetchAPI,
      mouseScrolling: true,
      scrollStep: 2,
    });
    const mouse = await runTuiPreferenceCommand({
      argument: "off",
      command: "mouse",
      fetchAPI,
      mouseScrolling: true,
      scrollStep: 5,
    });
    expect(scroll.scrollStep).toBe(5);
    expect(mouse.mouseScrolling).toBe(false);
    expect(bodies.map((body) => JSON.parse(body) as unknown)).toEqual([
      { tui: { mouseScrolling: true, scrollStep: 5 } },
      { tui: { mouseScrolling: false, scrollStep: 5 } },
    ]);
  });

  test("rejects invalid values and failed persistence", async () => {
    const invalid = await runTuiPreferenceCommand({
      argument: "20",
      command: "scroll",
      fetchAPI: async () => ({ success: true }),
      mouseScrolling: true,
      scrollStep: 2,
    });
    const failed = await runTuiPreferenceCommand({
      argument: "3",
      command: "scroll",
      fetchAPI: async () => null,
      mouseScrolling: true,
      scrollStep: 2,
    });
    expect(invalid.notice).toBe("Usage: /scroll <1-8|show>");
    expect(failed.notice).toBe("Gateway rejected the terminal preference.");
  });
});
