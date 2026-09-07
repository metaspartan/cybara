import { describe, expect, test } from "bun:test";
import { join } from "path";
import { cybaraDir } from "../../src/core/paths";
import { isViewedMediaPath, registerViewedMediaPath } from "../../src/core/viewed-media";

describe("viewed media registry", () => {
  test("remembers local image paths the agent viewed and ignores remote or inline sources", () => {
    const viewed = join(cybaraDir, "test_viewed_media", "render.png");
    expect(isViewedMediaPath(viewed)).toBe(false);
    registerViewedMediaPath(viewed);
    expect(isViewedMediaPath(viewed)).toBe(true);
    expect(
      isViewedMediaPath(
        join(cybaraDir, "test_viewed_media", "..", "test_viewed_media", "render.png")
      )
    ).toBe(true);
    registerViewedMediaPath("data:image/png;base64,AAAA");
    registerViewedMediaPath("https://example.com/render.png");
    expect(isViewedMediaPath("data:image/png;base64,AAAA")).toBe(false);
    expect(isViewedMediaPath("https://example.com/render.png")).toBe(false);
  });
});
