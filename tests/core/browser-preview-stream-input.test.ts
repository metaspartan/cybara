import { describe, expect, test } from "bun:test";
import {
  BrowserPreviewInputQueue,
  executeBrowserPreviewInput,
  parseBrowserPreviewInput,
  type BrowserPreviewInputHandlers,
} from "../../src/core/browser/preview-stream-input";

describe("browser preview stream input", () => {
  test("parses supported input and bounds scroll bursts", () => {
    expect(parseBrowserPreviewInput({ type: "scroll", deltaX: 5_000, deltaY: -5_000 })).toEqual({
      type: "scroll",
      deltaX: 4_000,
      deltaY: -4_000,
    });
    expect(parseBrowserPreviewInput({ type: "pointer_click", x: 120.5, y: 64 })).toEqual({
      type: "pointer_click",
      x: 120.5,
      y: 64,
    });
    expect(parseBrowserPreviewInput({ type: "pointer_move", x: 9, y: 10 })).toEqual({
      type: "pointer_move",
      x: 9,
      y: 10,
    });
    expect(parseBrowserPreviewInput({ type: "pointer_down", x: 11, y: 12 })).toEqual({
      type: "pointer_down",
      x: 11,
      y: 12,
    });
    expect(parseBrowserPreviewInput({ type: "pointer_up", x: 13, y: 14 })).toEqual({
      type: "pointer_up",
      x: 13,
      y: 14,
    });
    expect(parseBrowserPreviewInput({ type: "keyboard", key: "Meta+K" })).toEqual({
      type: "keyboard",
      key: "Meta+K",
    });
    expect(parseBrowserPreviewInput({ type: "text", text: "pasted text" })).toEqual({
      type: "text",
      text: "pasted text",
    });
  });

  test("rejects malformed and unbounded input", () => {
    expect(parseBrowserPreviewInput(null)).toBeNull();
    expect(parseBrowserPreviewInput({ type: "scroll", deltaX: Number.NaN, deltaY: 1 })).toBeNull();
    expect(
      parseBrowserPreviewInput({ type: "pointer_click", x: 1, y: Number.POSITIVE_INFINITY })
    ).toBeNull();
    expect(parseBrowserPreviewInput({ type: "pointer_click", x: -1, y: 2 })).toBeNull();
    expect(parseBrowserPreviewInput({ type: "pointer_click", x: 10_001, y: 2 })).toBeNull();
    expect(parseBrowserPreviewInput({ type: "keyboard", key: "" })).toBeNull();
    expect(parseBrowserPreviewInput({ type: "keyboard", key: "x".repeat(33) })).toBeNull();
    expect(parseBrowserPreviewInput({ type: "text", text: "" })).toBeNull();
    expect(parseBrowserPreviewInput({ type: "text", text: "x".repeat(1_001) })).toBeNull();
    expect(parseBrowserPreviewInput({ type: "unknown" })).toBeNull();
  });

  test("executes validated input and invalidates the next frame", async () => {
    const calls: string[] = [];
    const handlers: BrowserPreviewInputHandlers = {
      async scroll(pageId, deltaX, deltaY) {
        calls.push(`scroll:${pageId}:${deltaX}:${deltaY}`);
      },
      async click(pageId, x, y) {
        calls.push(`click:${pageId}:${x}:${y}`);
      },
      async move(pageId, x, y) {
        calls.push(`move:${pageId}:${x}:${y}`);
      },
      async pointerDown(pageId, x, y) {
        calls.push(`down:${pageId}:${x}:${y}`);
      },
      async pointerUp(pageId, x, y) {
        calls.push(`up:${pageId}:${x}:${y}`);
      },
      async keyboard(pageId, key) {
        calls.push(`keyboard:${pageId}:${key}`);
      },
      async text(pageId, text) {
        calls.push(`text:${pageId}:${text}`);
      },
      invalidate(pageId) {
        calls.push(`invalidate:${pageId}`);
      },
    };

    await executeBrowserPreviewInput("page-1", { type: "scroll", deltaX: 4, deltaY: 8 }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "pointer_click", x: 10, y: 20 }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "pointer_move", x: 11, y: 21 }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "pointer_down", x: 12, y: 22 }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "pointer_up", x: 13, y: 23 }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "keyboard", key: "Enter" }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "text", text: "hello" }, handlers);

    expect(calls).toEqual([
      "scroll:page-1:4:8",
      "invalidate:page-1",
      "click:page-1:10:20",
      "invalidate:page-1",
      "move:page-1:11:21",
      "invalidate:page-1",
      "down:page-1:12:22",
      "invalidate:page-1",
      "up:page-1:13:23",
      "invalidate:page-1",
      "keyboard:page-1:Enter",
      "invalidate:page-1",
      "text:page-1:hello",
      "invalidate:page-1",
    ]);
  });

  test("coalesces queued scrolling without crossing click or keyboard boundaries", async () => {
    let releaseFirst: (() => void) | null = null;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const executed: string[] = [];
    const queue = new BrowserPreviewInputQueue(async (input) => {
      if (input.type === "scroll") {
        executed.push(`scroll:${input.deltaX}:${input.deltaY}`);
        if (executed.length === 1) await firstPending;
      } else if (input.type === "pointer_click") {
        executed.push(`click:${input.x}:${input.y}`);
      } else if (input.type === "keyboard") {
        executed.push(`keyboard:${input.key}`);
      } else {
        executed.push(input.type);
      }
    });

    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 10 });
    await Bun.sleep(0);
    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 20 });
    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 30 });
    queue.enqueue({ type: "pointer_click", x: 40, y: 50 });
    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 60 });
    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 70 });
    queue.enqueue({ type: "keyboard", key: "Enter" });
    releaseFirst?.();
    await queue.whenIdle();

    expect(executed).toEqual([
      "scroll:0:10",
      "scroll:0:50",
      "click:40:50",
      "scroll:0:130",
      "keyboard:Enter",
    ]);
    queue.dispose();
  });

  test("coalesces pointer movement without crossing press boundaries", async () => {
    let releaseFirst: (() => void) | null = null;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const executed: string[] = [];
    const queue = new BrowserPreviewInputQueue(async (input) => {
      if (input.type === "pointer_move") {
        executed.push(`move:${input.x}:${input.y}`);
        if (executed.length === 1) await firstPending;
      } else if (input.type === "pointer_down" || input.type === "pointer_up") {
        executed.push(`${input.type}:${input.x}:${input.y}`);
      }
    });
    queue.enqueue({ type: "pointer_move", x: 1, y: 1 });
    await Bun.sleep(0);
    queue.enqueue({ type: "pointer_move", x: 2, y: 2 });
    queue.enqueue({ type: "pointer_move", x: 3, y: 3 });
    queue.enqueue({ type: "pointer_down", x: 3, y: 3 });
    queue.enqueue({ type: "pointer_move", x: 4, y: 4 });
    queue.enqueue({ type: "pointer_move", x: 5, y: 5 });
    queue.enqueue({ type: "pointer_up", x: 5, y: 5 });
    releaseFirst?.();
    await queue.whenIdle();
    expect(executed).toEqual([
      "move:1:1",
      "move:3:3",
      "pointer_down:3:3",
      "move:5:5",
      "pointer_up:5:5",
    ]);
    queue.dispose();
  });

  test("bounds merged gateway scroll packets and reports execution errors", async () => {
    const errors: string[] = [];
    const executed: number[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = new BrowserPreviewInputQueue(
      async (input) => {
        if (input.type !== "scroll") throw new Error("unexpected input");
        executed.push(input.deltaY);
        if (executed.length === 1) await firstPending;
        else throw new Error("scroll failed");
      },
      (error) => errors.push(error instanceof Error ? error.message : String(error))
    );

    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 1 });
    await Bun.sleep(0);
    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 3_000 });
    queue.enqueue({ type: "scroll", deltaX: 0, deltaY: 3_000 });
    releaseFirst?.();
    await queue.whenIdle();

    expect(executed).toEqual([1, 4_000]);
    expect(errors).toEqual(["scroll failed"]);
    queue.dispose();
  });
});
