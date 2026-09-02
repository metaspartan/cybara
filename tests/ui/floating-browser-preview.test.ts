import { describe, expect, test } from "bun:test";
import {
  clampFloatingBrowserPreviewRect,
  defaultFloatingBrowserPreviewRect,
  isFloatingBrowserPreviewClick,
  parseFloatingBrowserPreviewRect,
  shouldShowFloatingBrowserPreview,
} from "../../ui/src/pages/chat/floatingBrowserPreviewModel";

describe("floating browser preview", () => {
  test("defaults above the composer and stays inside the chat surface", () => {
    expect(defaultFloatingBrowserPreviewRect({ width: 1_000, height: 800 }, 120)).toEqual({
      x: 728,
      y: 488,
      width: 260,
      height: 180,
    });
    expect(defaultFloatingBrowserPreviewRect({ width: 1_000, height: 800 }, 120, "left")).toEqual({
      x: 12,
      y: 488,
      width: 260,
      height: 180,
    });
    expect(
      clampFloatingBrowserPreviewRect(
        { width: 390, height: 700 },
        { x: -100, y: 900, width: 900, height: 900 },
        100
      )
    ).toEqual({ x: 12, y: 408, width: 260, height: 180 });
  });

  test("parses only finite persisted geometry", () => {
    expect(parseFloatingBrowserPreviewRect('{"x":20,"y":30,"width":500,"height":320}')).toEqual({
      x: 20,
      y: 30,
      width: 500,
      height: 320,
    });
    expect(parseFloatingBrowserPreviewRect('{"x":20,"y":30,"width":0,"height":320}')).toBeNull();
    expect(parseFloatingBrowserPreviewRect("not-json")).toBeNull();
  });

  test("appears whenever browser work is available outside the browser panel", () => {
    const base = {
      activeWorkspaceKind: null,
      artifactOpen: false,
      available: true,
      sessionId: "session-1",
      workspacePanelOpen: false,
    };
    expect(shouldShowFloatingBrowserPreview(base)).toBe(true);
    expect(
      shouldShowFloatingBrowserPreview({
        ...base,
        activeWorkspaceKind: "terminal",
        workspacePanelOpen: true,
      })
    ).toBe(true);
    expect(
      shouldShowFloatingBrowserPreview({
        ...base,
        activeWorkspaceKind: "browser",
        workspacePanelOpen: true,
      })
    ).toBe(false);
    expect(shouldShowFloatingBrowserPreview({ ...base, sessionId: null })).toBe(false);
    expect(
      shouldShowFloatingBrowserPreview({
        ...base,
        activeWorkspaceKind: "computer",
        previewKind: "computer",
        workspacePanelOpen: true,
      })
    ).toBe(false);
  });

  test("opens on a click while preserving drag gestures", () => {
    expect(isFloatingBrowserPreviewClick(0, 0)).toBe(true);
    expect(isFloatingBrowserPreviewClick(4, 4)).toBe(true);
    expect(isFloatingBrowserPreviewClick(7, 0)).toBe(false);
    expect(isFloatingBrowserPreviewClick(24, 18)).toBe(false);
  });
});
