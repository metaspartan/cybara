import { describe, expect, test } from "bun:test";
import {
  containedPreviewRect,
  containerPointToSource,
  containerPointToPreview,
  previewPointToContainer,
  sourcePointToContainer,
} from "../../ui/src/pages/chat/previewGeometry";

describe("contained chat preview geometry", () => {
  test("centers a wide screenshot inside a tall panel", () => {
    expect(containedPreviewRect({ width: 500, height: 500 }, { width: 1000, height: 500 })).toEqual(
      {
        left: 0,
        top: 125,
        width: 500,
        height: 250,
      }
    );
  });

  test("maps agent cursor coordinates through letterboxing", () => {
    expect(
      previewPointToContainer(
        { width: 500, height: 500 },
        { width: 1000, height: 500 },
        { x: 500, y: 250 }
      )
    ).toEqual({ x: 250, y: 250 });
  });

  test("maps user clicks back into the browser viewport", () => {
    expect(
      containerPointToPreview(
        { width: 500, height: 500 },
        { width: 1000, height: 500 },
        { x: 250, y: 250 }
      )
    ).toEqual({ x: 500, y: 250 });
    expect(
      containerPointToPreview(
        { width: 500, height: 500 },
        { width: 1000, height: 500 },
        { x: 250, y: 40 }
      )
    ).toBeNull();
  });

  test("maps resized simulator previews into native input coordinates", () => {
    expect(
      containerPointToSource(
        { width: 360, height: 800 },
        { width: 720, height: 1600 },
        { width: 1080, height: 2400 },
        { x: 180, y: 400 }
      )
    ).toEqual({ x: 540, y: 1200 });
  });

  test("maps native simulator agent taps into the resized preview", () => {
    expect(
      sourcePointToContainer(
        { width: 360, height: 800 },
        { width: 720, height: 1600 },
        { width: 1080, height: 2400 },
        { x: 540, y: 1200 }
      )
    ).toEqual({ x: 180, y: 400 });
  });

  test("clamps out-of-range driver coordinates to the visible image", () => {
    expect(
      previewPointToContainer(
        { width: 300, height: 200 },
        { width: 100, height: 100 },
        { x: 120, y: -10 }
      )
    ).toEqual({ x: 250, y: 0 });
  });

  test("rejects invalid dimensions and non-finite points", () => {
    expect(containedPreviewRect({ width: 0, height: 100 }, { width: 10, height: 10 })).toBeNull();
    expect(
      previewPointToContainer(
        { width: 100, height: 100 },
        { width: 10, height: 10 },
        { x: Number.NaN, y: 1 }
      )
    ).toBeNull();
  });
});
