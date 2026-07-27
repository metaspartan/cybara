import { describe, expect, test } from "bun:test";
import { isRenderableSimulatorImage } from "../../ui/src/pages/chat/SimulatorPreviewImage";

describe("simulator preview image", () => {
  test("presents only completely decoded images with valid dimensions", () => {
    expect(
      isRenderableSimulatorImage({ complete: true, naturalHeight: 1_600, naturalWidth: 736 })
    ).toBe(true);
    expect(
      isRenderableSimulatorImage({ complete: false, naturalHeight: 1_600, naturalWidth: 736 })
    ).toBe(false);
    expect(isRenderableSimulatorImage({ complete: true, naturalHeight: 0, naturalWidth: 736 })).toBe(
      false
    );
    expect(isRenderableSimulatorImage({ complete: true, naturalHeight: 1_600, naturalWidth: 0 })).toBe(
      false
    );
  });

  test("retains the previous frame until a valid replacement is ready", async () => {
    const source = await Bun.file("ui/src/pages/chat/SimulatorPreviewImage.tsx").text();

    expect(source).toContain("const [presentedSource, setPresentedSource]");
    expect(source).toContain("window.requestAnimationFrame");
    expect(source).toContain('!presentedSource && "invisible"');
    expect(source).not.toContain("next.decode().then(swap, swap)");
    expect(source).not.toContain("next.onerror = swap");
  });

  test("fills the responsive preview surface without distorting the device image", async () => {
    const source = await Bun.file("ui/src/pages/chat/ChatWorkspaceSimulator.tsx").text();

    expect(source).toContain('className="h-full w-full select-none object-contain"');
    expect(source).not.toContain('className="max-h-full max-w-full select-none object-contain"');
  });
});
