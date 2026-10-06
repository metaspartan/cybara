import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  browserPreviewInputAction,
  browserPreviewInputBody,
  isPreviewPointerButton,
  normalizeBrowserPointerButton,
} from "../../shared/browser-preview-input";
import {
  executeBrowserPreviewInput,
  parseBrowserPreviewInput,
} from "../../src/core/browser/preview-stream-input";
import {
  DEFAULT_LOCAL_CHROME_CDP_PORT,
  localChromeLaunchHint,
  normalizeLocalChromePort,
  probeLocalChrome,
} from "../../src/core/browser/local-chrome";

const root = join(import.meta.dir, "..", "..");
const readSource = (relative: string): string => readFileSync(join(root, relative), "utf8");

describe("center click reaches the embedded page", () => {
  test("the preview surface no longer rejects non-left buttons", () => {
    const source = readSource("ui/src/pages/chat/ChatWorkspaceBrowser.tsx");
    expect(source).not.toContain("event.button !== 0");
    expect(source).toContain("isPreviewPointerButton(event.button)");
    expect(source).toContain("normalizeBrowserPointerButton(event.button)");
    expect(source).toContain('pointer_down", x: point.x, y: point.y, button');
  });

  test("a middle pointer sequence is forwarded with its button", async () => {
    const seen: Array<[string, number, number, number]> = [];
    const handlers = {
      scroll: async () => undefined,
      click: async (_p: string, _x: number, _y: number, button: number) => {
        seen.push(["click", 0, 0, button]);
      },
      move: async () => undefined,
      pointerDown: async (_p: string, _x: number, _y: number, button: number) => {
        seen.push(["down", 0, 0, button]);
      },
      pointerUp: async (_p: string, _x: number, _y: number, button: number) => {
        seen.push(["up", 0, 0, button]);
      },
      keyboard: async () => undefined,
      text: async () => undefined,
      invalidate: () => undefined,
    };
    const down = parseBrowserPreviewInput({ type: "pointer_down", x: 12, y: 34, button: 1 });
    const up = parseBrowserPreviewInput({ type: "pointer_up", x: 12, y: 34, button: 1 });
    expect(down).toEqual({ type: "pointer_down", x: 12, y: 34, button: 1 });
    expect(up).toEqual({ type: "pointer_up", x: 12, y: 34, button: 1 });
    if (!down || !up) throw new Error("unreachable");
    await executeBrowserPreviewInput("page", down, handlers);
    await executeBrowserPreviewInput("page", up, handlers);
    expect(seen).toEqual([
      ["down", 0, 0, 1],
      ["up", 0, 0, 1],
    ]);
  });

  test("every button survives parse, route body and mouse mapping", () => {
    for (const button of [0, 1, 2] as const) {
      const parsed = parseBrowserPreviewInput({
        type: "pointer_click",
        x: 5,
        y: 6,
        button,
      });
      expect(parsed).toEqual({ type: "pointer_click", x: 5, y: 6, button });
      if (!parsed) throw new Error("unreachable");
      expect(browserPreviewInputAction(parsed)).toBe("pointer/click");
      expect(browserPreviewInputBody(parsed)).toEqual({ x: 5, y: 6, button });
    }
    const driver = readSource("src/core/browser/automation-driver.ts");
    expect(driver).toContain('"left" | "middle" | "right"');
    const manager = readSource("src/core/browser/pw-manager.ts");
    expect(manager).toContain("PLAYWRIGHT_MOUSE_BUTTON");
    expect(manager).toContain('1: "middle"');
  });

  test("missing or hostile button values fail closed to left click", () => {
    expect(normalizeBrowserPointerButton(undefined)).toBe(0);
    expect(normalizeBrowserPointerButton(7)).toBe(0);
    expect(normalizeBrowserPointerButton(-1)).toBe(0);
    expect(normalizeBrowserPointerButton("1")).toBe(0);
    expect(parseBrowserPreviewInput({ type: "pointer_click", x: 1, y: 1, button: 9 })).toEqual({
      type: "pointer_click",
      x: 1,
      y: 1,
      button: 0,
    });
    expect(isPreviewPointerButton(0)).toBe(true);
    expect(isPreviewPointerButton(4)).toBe(false);
  });

  test("right click is forwarded instead of opening the host context menu", () => {
    const source = readSource("ui/src/pages/chat/ChatWorkspaceBrowser.tsx");
    expect(source).toContain("onContextMenu={handlePreviewContextMenu}");
    expect(source).toContain("button: 2");
  });
});

describe("local Chrome attachment", () => {
  test("port normalization confines the debugger to a sane local range", () => {
    expect(normalizeLocalChromePort(undefined)).toBe(DEFAULT_LOCAL_CHROME_CDP_PORT);
    expect(normalizeLocalChromePort("9223")).toBe(9223);
    expect(normalizeLocalChromePort(9333.9)).toBe(9333);
    expect(normalizeLocalChromePort(80)).toBe(DEFAULT_LOCAL_CHROME_CDP_PORT);
    expect(normalizeLocalChromePort(70_000)).toBe(DEFAULT_LOCAL_CHROME_CDP_PORT);
    expect(normalizeLocalChromePort(Number.NaN)).toBe(DEFAULT_LOCAL_CHROME_CDP_PORT);
  });

  test("an unreachable or malformed debugger is never reported as reachable", async () => {
    const unreachable = await probeLocalChrome(1);
    expect(unreachable.reachable).toBe(false);
    expect(unreachable.reason).toBeTruthy();
    expect(localChromeLaunchHint(9222)).toContain("--remote-debugging-port=9222");
  });

  test("attaching can never close the user's browser", () => {
    const source = readSource("src/core/browser/local-chrome.ts");
    expect(source).toContain("browser.disconnect()");
    expect(source).not.toMatch(/\.browser\.close\(/);
    const driver = readSource("src/core/browser/automation-driver.ts");
    expect(driver).toContain("this.browser.disconnect()");
  });

  test("the local Chrome routes are refused for remote callers", () => {
    const source = readSource("src/api/routes/runtime-routes.ts");
    expect(source).toContain('"POST /api/browser/local-chrome/attach"');
    expect(source).toContain('"POST /api/browser/local-chrome/detach"');
    expect(source).toContain("localBrowserRemoteAccessError");
    const port = normalizeLocalChromePort(9222);
    expect(port).toBe(9222);
  });
});
