import { describe, expect, test } from "bun:test";
import {
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
    expect(parseBrowserPreviewInput({ type: "keyboard", key: "Meta+K" })).toEqual({
      type: "keyboard",
      key: "Meta+K",
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
      async keyboard(pageId, key) {
        calls.push(`keyboard:${pageId}:${key}`);
      },
      invalidate(pageId) {
        calls.push(`invalidate:${pageId}`);
      },
    };

    await executeBrowserPreviewInput("page-1", { type: "scroll", deltaX: 4, deltaY: 8 }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "pointer_click", x: 10, y: 20 }, handlers);
    await executeBrowserPreviewInput("page-1", { type: "keyboard", key: "Enter" }, handlers);

    expect(calls).toEqual([
      "scroll:page-1:4:8",
      "invalidate:page-1",
      "click:page-1:10:20",
      "invalidate:page-1",
      "keyboard:page-1:Enter",
      "invalidate:page-1",
    ]);
  });
});
